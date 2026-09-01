const express = require("express");

const app = express();

app.use(express.json());
app.use(express.static("."));

const BOT_TOKEN = "8878514370:AAEdLsm7iLcIOj4S4_7kavHHe0fvQOC1toY";
const CHAT_ID = "7449188324";

app.post("/message", async (req, res) => {
  const message = String(req.body.message || "").trim();

  if (!message) {
    return res.status(400).json({
      success: false,
      error: "Message is empty"
    });
  }

  try {
    const telegramResponse = await fetch(
      `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          chat_id: CHAT_ID,
          text: "📩 Anonymous Message\n\n" + message
        })
      }
    );

    if (!telegramResponse.ok) {
      return res.status(500).json({
        success: false,
        error: "Telegram delivery failed"
      });
    }

    res.json({
      success: true
    });

  } catch (error) {
    console.error(error);

    res.status(500).json({
      success: false,
      error: "Server error"
    });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});