// FIX A1: `referrer` was destructured from req.query but never used anywhere in the file.
// Dead variable removed to avoid confusion with the HTTP `referer` header also present.

const COOKIE_MAX_AGE = 30 * 24 * 60 * 60 * 1000; // 30 days

const buildCookieOptions = () => ({
  maxAge: COOKIE_MAX_AGE,
  httpOnly: false, // Must be readable by frontend analytics scripts
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax"
});

export const captureUTMParameters = (req, res, next) => {
  try {
    const {
      utm_source,
      utm_medium,
      utm_campaign,
      utm_term,
      utm_content,
      ref
      // FIX A1: `referrer` removed — was destructured from query but never used.
      // HTTP referrer is captured separately via req.headers.referer below.
    } = req.query;

    if (utm_source || utm_medium || utm_campaign || ref) {
      const cookieOptions = buildCookieOptions();

      if (utm_source)  res.cookie("utm_source",  utm_source,  cookieOptions);
      if (utm_medium)  res.cookie("utm_medium",  utm_medium,  cookieOptions);
      if (utm_campaign) res.cookie("utm_campaign", utm_campaign, cookieOptions);
      if (utm_term)    res.cookie("utm_term",    utm_term,    cookieOptions);
      if (utm_content) res.cookie("utm_content", utm_content, cookieOptions);
      if (ref)         res.cookie("ref_code",    ref,         cookieOptions);
    }

    // Capture HTTP Referrer header (first visit only)
    const httpReferrer = req.headers.referer || req.headers.referrer;
    if (httpReferrer && !req.cookies.initial_referrer) {
      res.cookie("initial_referrer", httpReferrer, buildCookieOptions());
    }

    // Capture landing page (first visit only)
    if (!req.cookies.landing_page) {
      const landingPage = req.originalUrl || req.url;
      res.cookie("landing_page", landingPage, buildCookieOptions());
    }

    next();
  } catch (error) {
    console.error("UTM tracking error:", error);
    next();
  }
};

export const getAttributionData = (req) => ({
  source:     req.cookies.utm_source   || req.query.utm_source   || "direct",
  medium:     req.cookies.utm_medium   || req.query.utm_medium   || null,
  campaign:   req.cookies.utm_campaign || req.query.utm_campaign || null,
  term:       req.cookies.utm_term     || req.query.utm_term     || null,
  content:    req.cookies.utm_content  || req.query.utm_content  || null,
  referrer:   req.cookies.initial_referrer || req.headers.referer || req.headers.referrer || null,
  landingPage: req.cookies.landing_page || null,
  refCode:    req.cookies.ref_code     || null
});

export const attachAttributionData = (req, res, next) => {
  try {
    req.attributionData = getAttributionData(req);
    next();
  } catch (error) {
    console.error("Attribution data error:", error);
    req.attributionData = { source: "direct" };
    next();
  }
};

export const getDeviceType = (userAgent) => {
  if (!userAgent) return "desktop";
  const ua = userAgent.toLowerCase();
  if (/(tablet|ipad|playbook|silk)|(android(?!.*mobi))/i.test(ua)) return "tablet";
  if (/Mobile|Android|iP(hone|od)|IEMobile|BlackBerry|Kindle|Silk-Accelerated|(hpw|web)OS|Opera M(obi|ini)/.test(ua)) return "mobile";
  return "desktop";
};

export const getBrowser = (userAgent) => {
  if (!userAgent) return "unknown";
  const ua = userAgent.toLowerCase();
  if (ua.includes("edg/"))                                     return "Edge";
  if (ua.includes("chrome/"))                                  return "Chrome";
  if (ua.includes("safari/") && !ua.includes("chrome"))       return "Safari";
  if (ua.includes("firefox/"))                                 return "Firefox";
  if (ua.includes("opera/") || ua.includes("opr/"))           return "Opera";
  if (ua.includes("trident/") || ua.includes("msie"))         return "IE";
  return "unknown";
};

export const captureDeviceInfo = (req, res, next) => {
  try {
    const userAgent = req.headers["user-agent"];
    req.deviceInfo = {
      device: getDeviceType(userAgent),
      browser: getBrowser(userAgent),
      userAgent
    };
    next();
  } catch (error) {
    console.error("Device info capture error:", error);
    req.deviceInfo = { device: "desktop", browser: "unknown", userAgent: null };
    next();
  }
};

// Composite middleware — chains UTM → device → attribution attachment
export const trackAttribution = (req, res, next) => {
  captureUTMParameters(req, res, () => {
    captureDeviceInfo(req, res, () => {
      attachAttributionData(req, res, next);
    });
  });
};

export default {
  captureUTMParameters,
  getAttributionData,
  attachAttributionData,
  captureDeviceInfo,
  trackAttribution,
  getDeviceType,
  getBrowser
};