const ALLOWED_PERIODS = new Set(["24h", "week", "month", "year", "decade"]);

exports.handler = async event => {
  const headers = {
    "Content-Type":"application/json; charset=utf-8",
    "Cache-Control":"public, max-age=20, s-maxage=45",
    "X-Content-Type-Options":"nosniff"
  };

  try{
    const source = process.env.WEATHER_API_URL;
    if(!source){
      return {
        statusCode:500,
        headers,
        body:JSON.stringify({ error:"Missing WEATHER_API_URL environment variable" })
      };
    }

    const requested = event.queryStringParameters?.period || "24h";
    const period = ALLOWED_PERIODS.has(requested) ? requested : "24h";
    const url = new URL(source);
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
    return {
      statusCode:response.ok ? 200 : response.status,
      headers,
      body:text
    };
  }catch(error){
    return {
      statusCode:502,
      headers,
      body:JSON.stringify({ error:"Weather upstream unavailable" })
    };
  }
};
