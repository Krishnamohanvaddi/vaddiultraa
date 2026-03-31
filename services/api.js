const BASE_URL = "http://127.0.0.1:8000";

export const sendMessageToAgent = async (message, sessionId) => {
  try {
    const response = await fetch(`${BASE_URL}/agent`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message,
        sessionId,
      }),
    });

    const data = await response.json();
    return data.response;
  } catch (error) {
    console.error("API Error:", error);
    return "❌ Server error";
  }
};