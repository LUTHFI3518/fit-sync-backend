const axios = require("axios");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const makeVisionRequest = async (imageBase64) => {
  return axios.post(
    "https://openrouter.ai/api/v1/chat/completions",
    {
      model: "mistralai/mistral-small-3.1-24b-instruct:free",
      messages: [
        {
          role: "system",
          content: `
You are a food recognition AI.

Analyze the food image and estimate the portion size.

Return ONLY valid JSON in this format:

{
  "foodName": "string",
  "estimatedQuantity": number,
  "unit": "string",
  "confidence": number
}

Examples:

{
  "foodName": "boiled eggs",
  "estimatedQuantity": 2,
  "unit": "eggs",
  "confidence": 0.92
}

{
  "foodName": "fried rice",
  "estimatedQuantity": 1,
  "unit": "plate",
  "confidence": 0.78
}

If you are uncertain, lower the confidence score.
`,
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Analyze this food image.",
            },
            {
              type: "image_url",
              image_url: {
                url: imageBase64,
              },
            },
          ],
        },
      ],
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
      },
    }
  );
};

exports.recognizeFood = async (imageBase64) => {
  const maxRetries = 3;
  const retryDelays = [3000, 7000, 15000]; // 3s, 7s, 15s

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await makeVisionRequest(imageBase64);
      const content = response.data.choices[0].message.content;

      // Strip markdown code fences if present
      const cleaned = content.replace(/```json|```/g, "").trim();

      try {
        return JSON.parse(cleaned);
      } catch {
        throw new Error("Vision model returned invalid JSON");
      }
    } catch (error) {
      const status = error.response?.status;

      if (status === 429) {
        if (attempt < maxRetries - 1) {
          console.warn(
            `Vision API rate limited (429). Retrying in ${retryDelays[attempt] / 1000}s... (attempt ${attempt + 1}/${maxRetries})`
          );
          await sleep(retryDelays[attempt]);
          continue;
        } else {
          throw new Error(
            "The food recognition service is temporarily rate-limited. Please wait a moment and try again."
          );
        }
      }

      // Any other error — rethrow
      throw error;
    }
  }
};