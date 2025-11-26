import express from "express";
import axios from "axios";
import cors from "cors";
import fs from "fs";
import dotenv from "dotenv";
dotenv.config();


const app = express();
app.use(cors());
app.use(express.json());

// Load trusted users
let trustedUsers = {};
try {
    if (fs.existsSync("trusted.json")) {
        trustedUsers = JSON.parse(fs.readFileSync("trusted.json"));
    }
} catch (err) {
    console.error("❌ Failed to load trusted.json:", err);
}

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_API = `https://api.telegram.org/bot${BOT_TOKEN}`;

function saveTrustedUsers() {
    fs.writeFileSync("trusted.json", JSON.stringify(trustedUsers, null, 2));
}

// ------------ TELEGRAM WEBHOOK --------------

app.post("/bot-webhook", async (req, res) => {
    const msg = req.body.message;
    if (!msg) return res.sendStatus(200);

    const chatId = msg.chat.id;
    const username = msg.from.username || null;

    if (msg.text === "/start") {
        // save chat
        trustedUsers[chatId] = {
            username,
            active: true
        };
        saveTrustedUsers();

        await axios.post(`${TELEGRAM_API}/sendMessage`, {
            chat_id: chatId,
            text: "👍 Bot connected successfully.\nNow you can receive SOS alerts."
        });
    }

    res.sendStatus(200);
});

// ------------ SEND SOS FROM APP -------------

app.post("/send-sos", async (req, res) => {
    const { contacts, message, coords, timestamp } = req.body;

    const text =
        `${message}\n\n📍 Location:\n` +
        `Lat: ${coords.lat}\nLon: ${coords.lon}\n` +
        `⏱ Time: ${timestamp}`;

    for (let contact of contacts) {
        let chatId = null;

        if (contact.startsWith("id_")) {
            // id_123456
            chatId = contact.slice(3);
        } else if (contact.startsWith("@")) {
            // @username
            const username = contact.slice(1);

            const entry = Object.entries(trustedUsers)
                .find(([id, data]) => data.username === username);

            if (entry) chatId = entry[0];
        }

        if (!chatId) {
            console.log(`❌ Contact ${contact} not found`);
            continue;
        }

        const userData = trustedUsers[chatId];
        if (!userData || !userData.active) {
            console.log(`❌ Contact ${contact} inactive`);
            continue;
        }

        try {
            await axios.post(`${TELEGRAM_API}/sendMessage`, {
                chat_id: chatId,
                text,
            });
            console.log(`✔️ Sent to ${contact}`);
        } catch (err) {
            console.error("Send error:", err.response?.data);
        }
    }

    res.json({ status: "OK" });
});


const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;


app.post("/ai-chat", async (req, res) => {
    const { message } = req.body;

    if (!message || message.trim().length === 0) {
        return res.status(400).json({ error: "Message is required" });
    }

    try {
        const response = await axios.post(
            "https://openrouter.ai/api/v1/chat/completions",
            {
                model: "google/gemma-3-27b-it",
                messages: [
                    {
                        role: "system",
                        content:
                            "You are a supportive AI psychologist. Speak kindly, simply, clearly, briefly. Give practical advice but never medical diagnoses.",
                    },
                    {
                        role: "user",
                        content: message,
                    },
                ],
                temperature: 0.6,
                max_tokens: 300,
            },
            {
                headers: {
                    "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
                    "HTTP-Referer": "https://yourapp.com",
                    "X-Title": "QadamVision AI Therapy",
                    "Content-Type": "application/json",
                },
            }
        );

        const aiReply = response.data.choices[0].message.content;
        return res.json({ reply: aiReply });

    } catch (err) {
        console.error("AI Chat Error:", err.response?.data || err);

        return res.status(500).json({
            error: "AI request failed",
            details: err.response?.data
        });
    }
});



app.listen(3000, () => {
    console.log("Server running on http://localhost:3000");
});
