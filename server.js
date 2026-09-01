const express = require("express");
const path = require("path");

const app = express();

app.use(express.json());

// Serve the website
app.use(express.static(path.join(__dirname)));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// Receive anonymous messages
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
      `https://api.telegram.org/bot${process.env.BOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          chat_id: process.env.CHAT_ID,
          text: "📩 Anonymous Message\n\n" + message
        })
      }
    );

    if (!telegramResponse.ok) {
      console.error(await telegramResponse.text());

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