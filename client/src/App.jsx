import { useEffect, useRef, useState } from 'react'
import './App.css'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000/api'

function App() {
  const [catalog, setCatalog] = useState({ openingHours: '', activities: [], shows: [] })
  const [availability, setAvailability] = useState({ activities: [], shows: [] })
  const [sessionId, setSessionId] = useState('')
  const [messages, setMessages] = useState([
    {
      role: 'bot',
      text: 'Hello. I am MuseumBot. I can fully book your tickets in chat. Try: book 2 tickets.',
      suggestions: ['Book tickets', 'Museum timings', 'Activities', 'Show schedule'],
    },
  ])
  const [input, setInput] = useState('')
  const [isSending, setIsSending] = useState(false)
  const chatEndRef = useRef(null)

  useEffect(() => {
    const loadInitialData = async () => {
      try {
        const [catalogResponse, availabilityResponse] = await Promise.all([
          fetch(`${API_BASE_URL}/catalog`),
          fetch(`${API_BASE_URL}/availability`),
        ])
        const catalogData = await catalogResponse.json()
        const availabilityData = await availabilityResponse.json()
        setCatalog(catalogData)
        setAvailability(availabilityData)
      } catch (_error) {
        setMessages((prev) => [
          ...prev,
          {
            role: 'bot',
            text: 'Backend not reachable. Please start server on port 4000.',
          },
        ])
      }
    }

    loadInitialData()
  }, [])

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isSending])

  const refreshAvailability = async () => {
    try {
      const availabilityResponse = await fetch(`${API_BASE_URL}/availability`)
      const availabilityData = await availabilityResponse.json()
      setAvailability(availabilityData)
    } catch (_error) {
      // Ignore transient availability refresh failures in chat flow.
    }
  }

  const sendMessage = async (messageText) => {
    const trimmed = messageText.trim()
    if (!trimmed || isSending) {
      return
    }

    setInput('')
    setIsSending(true)
    setMessages((prev) => [...prev, { role: 'user', text: trimmed }])

    try {
      const response = await fetch(`${API_BASE_URL}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: trimmed,
          language: 'en',
          sessionId,
        }),
      })

      const data = await response.json()
      if (data.sessionId) {
        setSessionId(data.sessionId)
      }

      setMessages((prev) => [
        ...prev,
        {
          role: 'bot',
          text: data.reply || 'I am ready to help.',
          link: data.checkoutUrl || '',
          suggestions: data.suggestions || [],
        },
      ])

      await refreshAvailability()
    } catch (_error) {
      setMessages((prev) => [
        ...prev,
        {
          role: 'bot',
          text: 'Unable to process that request right now.',
        },
      ])
    } finally {
      setIsSending(false)
    }
  }

  const lastBotMessage = [...messages].reverse().find((message) => message.role === 'bot')

  const restartConversation = () => {
    setSessionId('')
    setMessages([
      {
        role: 'bot',
        text: 'Hello. I can help you book museum tickets step by step. You can ask about timings, gates, shows, and payment.',
        suggestions: ['Book tickets', 'Museum timings', 'Activities', 'Show schedule'],
      },
    ])
    setInput('')
  }

  return (
    <div className="page-shell">
      <header className="hero-header">
        <p className="eyebrow">City Museum Help Desk</p>
        <h1>Plan Your Museum Visit In Chat</h1>
        <p className="hero-copy">
          Ask in simple words. The assistant helps with visit timing, number of visitors, right gate, activities, show schedule, and ticket payment.
        </p>
        <div className="top-controls">
          <p className="language-pill">Language: English</p>
          <button type="button" className="secondary-btn" onClick={restartConversation}>
            Start New Chat
          </button>
        </div>

        <div className="help-cards" aria-label="Quick help options">
          <article>
            <h3>1. Ask</h3>
            <p>Try: "Book 2 tickets for tomorrow"</p>
          </article>
          <article>
            <h3>2. Confirm</h3>
            <p>The bot asks details one by one</p>
          </article>
          <article>
            <h3>3. Pay</h3>
            <p>Type "pay" and open the payment link</p>
          </article>
        </div>
      </header>

      <main className="main-grid two-column">
        <section className="chat-panel">
          <h2>Museum Assistant</h2>
          <div className="chat-window">
            {messages.map((message, index) => (
              <article key={`${message.role}-${index}`} className={`bubble bubble-${message.role}`}>
                <p className="bubble-role">{message.role === 'bot' ? 'Assistant' : 'You'}</p>
                <p>{message.text}</p>
                {message.link && (
                  <a className="pay-link" href={message.link} target="_blank" rel="noreferrer">
                    Open Secure Payment Page
                  </a>
                )}
              </article>
            ))}
            {isSending && (
              <article className="bubble bubble-bot">
                <p className="bubble-role">Assistant</p>
                <p className="typing">Typing...</p>
              </article>
            )}
            <div ref={chatEndRef} />
          </div>

          <form
            className="chat-form"
            onSubmit={(event) => {
              event.preventDefault()
              sendMessage(input)
            }}
          >
            <input
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="Type your question or booking request"
              aria-label="Type your message"
            />
            <button type="submit" disabled={isSending}>
              {isSending ? 'Sending...' : 'Send'}
            </button>
          </form>

          {lastBotMessage?.suggestions?.length > 0 && (
            <div className="suggestions-wrap">
              {lastBotMessage.suggestions.map((item) => (
                <button key={item} type="button" className="suggestion-chip" onClick={() => sendMessage(item)}>
                  {item}
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="analytics-panel">
          <h2>Activities And Schedule</h2>
          <p className="hint">Museum hours: {catalog.openingHours || '09:00 AM - 06:00 PM'}</p>

          <div className="info-block">
            <h3>Tickets Left For Activities</h3>
            <ul className="info-list">
              {availability.activities?.map((activity) => (
                <li key={activity.id}>
                  <span>{activity.name} ({activity.slot})</span>
                  <strong>{activity.ticketsLeft} left</strong>
                </li>
              ))}
            </ul>
          </div>

          <div className="info-block">
            <h3>Museum Show Schedule</h3>
            <ul className="info-list">
              {availability.shows?.map((show) => (
                <li key={show.id}>
                  <span>{show.name}</span>
                  <strong>{show.time}</strong>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </main>
    </div>
  )
}

export default App
