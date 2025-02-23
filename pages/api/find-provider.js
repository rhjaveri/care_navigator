import axios from "axios";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const { clinicalHelp, insuranceInfo } = req.body;

  try {
    // Call Browserbase Stagehand Web Agent
    const response = await axios.post("https://your-browserbase-api.com/agent", {
      query: { clinicalHelp, insuranceInfo },
    });

    // Simulate phone validation
    const validated = response.data.providers.map(async (provider) => {
      const phoneValid = await axios.post("https://your-twilio-api.com/validate", { phone: provider.phone });
      return { ...provider, phoneValid: phoneValid.data.valid };
    });

    const finalProviders = await Promise.all(validated);
    return res.status(200).json({ providers: finalProviders });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}