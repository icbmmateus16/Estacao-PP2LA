const ALLOWED_PERIODS = new Set(["24h", "week", "month", "year", "decade"]);

exports.handler = async event => {
  const headers = {
    "Content-Type":"application/json; charset=utf-8",
    "Cache-Control":"public, max-age=20, s-maxage=45",
    "X-Content-Type-Options":"nosniff"
  };

  try{
    const source = process.env.WEATHER_API_URL?.trim();
    if(!source){
      return {
        statusCode:500,
        headers,
        body:JSON.stringify({ error:"Missing WEATHER_API_URL environment variable" })
      };
    }

    const requested = event.queryStringParameters?.period || "24h";
    const period = ALLOWED_PERIODS.has(requested) ? requested : "24h";
    let url;
    try{
      url = new URL(source);
    }catch(error){
      return {
        statusCode:500,
        headers,
        body:JSON.stringify({ error:"Invalid WEATHER_API_URL. Use a complete https:// URL." })
      };
    }
    url.searchParams.set("action", "read");
    url.searchParams.set("period", period);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    const response = await fetch(url, {
      headers:{ "Accept":"application/json" },
      signal:controller.signal
    });
    clearTimeout(timeout);

    const text = await response.text();
    if(!response.ok){
      return {
        statusCode:response.status,
        headers,
        body:JSON.stringify({ error:"Weather upstream returned an error", status:response.status })
      };
    }

    return {
      statusCode:200,
      headers,
      body:text
    };
  }catch(error){
    const reason = error.name === "AbortError" ? "Weather upstream timeout" : "Weather upstream unavailable";
    return {
      statusCode:502,
      headers,
      body:JSON.stringify({ error:reason })
    };
  }
};
