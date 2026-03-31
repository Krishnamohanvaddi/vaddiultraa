import React, { useState } from "react";
import { sendMessageToAgent } from "../services/api";

const ChatBot = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");

  // 🔑 sessionId (important for confirmation flow)
  const sessionId = "user-session-1";

  const handleSend = async () => {
    if (!input.trim()) return;

    const userMessage = { type: "user", text: input };
    setMessages((prev) => [...prev, userMessage]);

    const botReply = await sendMessageToAgent(input, sessionId);

    const botMessage = { type: "bot", text: formatResponse(botReply) };

    setMessages((prev) => [...prev, botMessage]);
    setInput("");
  };

  // 🔥 format bot response (array or text)
  const formatResponse = (response) => {
    if (Array.isArray(response)) {
      return response
        .map(
          (item) =>
            `👤 ${item.clientName} | 📅 ${item.month} | 💰 ₹${item.amount}`
        )
        .join("\n");
    }
    return response;
  };

  return (
    <>
      {/* Floating Button */}
      <div
        onClick={() => setIsOpen(!isOpen)}
        style={styles.fab}
      >
        💬
      </div>

      {/* Chat Window */}
      {isOpen && (
        <div style={styles.chatContainer}>
          <div style={styles.header}>AI Assistant</div>

          <div style={styles.messages}>
            {messages.map((msg, index) => (
              <div
                key={index}
                style={
                  msg.type === "user"
                    ? styles.userMessage
                    : styles.botMessage
                }
              >
                {msg.text}
              </div>
            ))}
          </div>

          <div style={styles.inputContainer}>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask something..."
              style={styles.input}
              onKeyDown={(e) => e.key === "Enter" && handleSend()}
            />
            <button onClick={handleSend} style={styles.sendBtn}>
              Send
            </button>
          </div>
        </div>
      )}
    </>
  );
};

export default ChatBot;


// 🎨 Styles
const styles = {
  fab: {
    position: "fixed",
    bottom: "20px",
    right: "20px",
    background: "#007bff",
    color: "white",
    padding: "15px",
    borderRadius: "50%",
    cursor: "pointer",
    fontSize: "20px",
  },
  chatContainer: {
    position: "fixed",
    bottom: "80px",
    right: "20px",
    width: "300px",
    height: "400px",
    background: "white",
    borderRadius: "10px",
    boxShadow: "0px 0px 10px rgba(0,0,0,0.2)",
    display: "flex",
    flexDirection: "column",
  },
  header: {
    padding: "10px",
    background: "#007bff",
    color: "white",
    borderTopLeftRadius: "10px",
    borderTopRightRadius: "10px",
  },
  messages: {
    flex: 1,
    padding: "10px",
    overflowY: "auto",
  },
  userMessage: {
    textAlign: "right",
    marginBottom: "10px",
    background: "#DCF8C6",
    padding: "8px",
    borderRadius: "8px",
  },
  botMessage: {
    textAlign: "left",
    marginBottom: "10px",
    background: "#f1f1f1",
    padding: "8px",
    borderRadius: "8px",
    whiteSpace: "pre-line",
  },
  inputContainer: {
    display: "flex",
    borderTop: "1px solid #ddd",
  },
  input: {
    flex: 1,
    padding: "10px",
    border: "none",
    outline: "none",
  },
  sendBtn: {
    padding: "10px",
    background: "#007bff",
    color: "white",
    border: "none",
    cursor: "pointer",
  },
};