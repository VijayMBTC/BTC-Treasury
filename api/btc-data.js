export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET");
  try {
    const response = await fetch("https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=usd&days=365&interval=daily", { headers: { "Accept": "application/json", "x-cg-demo-api-key": "CG-b2qoMH8NfRuvJUJXohdMeFwb" } });
    const data = await response.json();
    res.setHeader("Cache-Control", "s-maxage=300");
    res.status(200).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}