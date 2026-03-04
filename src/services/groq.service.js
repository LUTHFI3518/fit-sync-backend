const axios = require("axios");

exports.chat = async (messages, tools = []) => {
  try {
    const response = await axios.post(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        model: "llama-3.3-70b-versatile",
        messages,
        tools,
        tool_choice: tools.length ? "auto" : "none",
        temperature: 0.3
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
          "Content-Type": "application/json"
        }
      }
    );

    return response.data.choices[0].message;

  } catch (error) {
    console.error("GROQ ERROR:", error.response?.data || error.message);
    throw new Error("Groq AI failed");
  }
};