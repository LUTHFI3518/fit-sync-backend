const axios = require("axios");
const FormData = require("form-data");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const makeVisionRequest = async (imageBase64) => {
  const form = new FormData();
  
  // Convert standard base64 string to a Buffer and append as file
  const imageBuffer = Buffer.from(imageBase64, "base64");
  form.append("imageFile", imageBuffer, { filename: "image.jpg" });

  return axios.post(
    "https://api.cloudmersive.com/image/recognize/describe",
    form,
    {
      headers: {
        Apikey: process.env.CLOUDMERSIVE_API_KEY,
        ...form.getHeaders(),
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
      
      const data = response.data;
      if (!data || !data.Successful) {
        throw new Error("Cloudmersive failed to recognize the image properly");
      }

      // We extract the best text description provided by Cloudmersive
      const bestOutcome = data.BestOutcome || {};
      const description = bestOutcome.Description || "unknown food";
      const confidence = bestOutcome.ConfidenceScore || 0;

      // Pack it into the format expected by our ai.controller.js
      return {
        foodName: description,
        estimatedQuantity: null,
        unit: "",
        confidence,
      };
      
    } catch (error) {
      const status = error.response?.status;

      // Rate handling specific limits (commonly 429)
      if (status === 429) {
        if (attempt < maxRetries - 1) {
          console.warn(
            `Vision API rate limited (429). Retrying in ${retryDelays[attempt] / 1000}s... (attempt ${attempt + 1}/${maxRetries})`
          );
          await sleep(retryDelays[attempt]);
          continue;
        } else {
          throw new Error(
            "The image recognition service is temporarily rate-limited. Please wait a moment and try again."
          );
        }
      }

      // Pass other errors up
      throw error;
    }
  }
};
