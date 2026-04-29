// تنظیم آدرس پایه مقصد از متغیرهای محیطی Netlify
// حذف اسلش انتهایی اگر وجود داشته باشد
const DESTINATION_BASE_URL = (Netlify.env.get("TARGET_DOMAIN") || "").replace(/\/$/, "");

// هدرهایی که نباید به سرور مقصد ارسال شوند
const EXCLUDED_HEADERS = new Set([
  "host",                    // هاست اصلی درخواست
  "connection",              // مدیریت اتصال
  "keep-alive",             // نگهداری اتصال زنده
  "proxy-authenticate",     // احراز هویت پروکسی
  "proxy-authorization",    // مجوز پروکسی
  "te",                     // انتقال رمزگذاری شده
  "trailer",                // تریلر هدرها
  "transfer-encoding",      // نوع رمزگذاری انتقال
  "upgrade",                // ارتقاء پروتکل
  "forwarded",              // هدرهای ارجاع شده
  "x-forwarded-host",       // هاست اصلی ارجاع شده
  "x-forwarded-proto",      // پروتکل اصلی ارجاع شده
  "x-forwarded-port",       // پورت اصلی ارجاع شده
]);

/**
 * تابع اصلی هندلر برای پروکسی کردن درخواست‌ها
 * @param {Request} incomingRequest - درخواست ورودی از کلاینت
 * @returns {Promise<Response>} - پاسخ از سرور مقصد
 */
export default async function handler(incomingRequest) {
  // بررسی وجود آدرس مقصد
  if (!DESTINATION_BASE_URL) {
    return new Response("Misconfigured: TARGET_DOMAIN is not set", { status: 500 });
  }

  try {
    // ساخت آدرس کامل مقصد با استفاده از مسیر و پارامترهای درخواست اصلی
    const requestUrl = new URL(incomingRequest.url);
    const fullTargetUrl = DESTINATION_BASE_URL + requestUrl.pathname + requestUrl.search;

    // آماده‌سازی هدرها برای ارسال به سرور مقصد
    const forwardedHeaders = new Headers();
    let originalClientIp = null;

    // پردازش و فیلتر کردن هدرهای ورودی
    for (const [headerName, headerValue] of incomingRequest.headers) {
      const lowerCaseHeader = headerName.toLowerCase();
      
      // رد کردن هدرهای غیرمجاز
      if (EXCLUDED_HEADERS.has(lowerCaseHeader)) continue;
      
      // رد کردن هدرهای مربوط به Netlify
      if (lowerCaseHeader.startsWith("x-nf-")) continue;
      if (lowerCaseHeader.startsWith("x-netlify-")) continue;
      
      // ذخیره IP اصلی کلاینت
      if (lowerCaseHeader === "x-real-ip") {
        originalClientIp = headerValue;
        continue;
      }
      
      // پردازش هدر x-forwarded-for
      if (lowerCaseHeader === "x-forwarded-for") {
        if (!originalClientIp) originalClientIp = headerValue;
        continue;
      }
      
      // اضافه کردن هدرهای مجاز به درخواست جدید
      forwardedHeaders.set(headerName, headerValue);
    }

    // اضافه کردن IP کلاینت به هدرهای ارسالی در صورت وجود
    if (originalClientIp) forwardedHeaders.set("x-forwarded-for", originalClientIp);

    // تعیین متد درخواست
    const requestMethod = incomingRequest.method;
    
    // بررسی وجود بدنه در درخواست (GET و HEAD بدنه ندارند)
    const hasRequestBody = requestMethod !== "GET" && requestMethod !== "HEAD";

    // تنظیمات درخواست به سرور مقصد
    const proxyRequestConfig = {
      method: requestMethod,
      headers: forwardedHeaders,
      redirect: "manual",    // عدم دنبال کردن خودکار ریدایرکت‌ها
    };

    // اضافه کردن بدنه در صورت وجود
    if (hasRequestBody) {
      proxyRequestConfig.body = incomingRequest.body;
    }

    // ارسال درخواست به سرور مقصد
    const upstreamResponse = await fetch(fullTargetUrl, proxyRequestConfig);

    // آماده‌سازی هدرهای پاسخ برای ارسال به کلاینت
    const responseHeaders = new Headers();
    for (const [headerName, headerValue] of upstreamResponse.headers) {
      // حذف هدر transfer-encoding از پاسخ
      if (headerName.toLowerCase() === "transfer-encoding") continue;
      responseHeaders.set(headerName, headerValue);
    }

    // بازگرداندن پاسخ به کلاینت
    return new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      headers: responseHeaders,
    });
    
  } catch (error) {
    // مدیریت خطاها - بازگرداندن خطای Bad Gateway
    console.error("Proxy error:", error);
    return new Response("Bad Gateway: Relay Failed", { status: 502 });
  }
}