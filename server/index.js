const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const Stripe = require('stripe');
const { v4: uuidv4 } = require('uuid');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;
const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:5173';
const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
const stripe = stripeSecretKey ? new Stripe(stripeSecretKey) : null;

app.use(cors({ origin: CLIENT_URL }));
app.use(express.json());

const ticketCatalog = {
  supportedLanguages: ['en'],
  openingHours: '09:00 AM - 06:00 PM',
  gates: [
    { id: 'gate-a', name: 'Gate A', useFor: 'General Entry' },
    { id: 'gate-b', name: 'Gate B', useFor: 'Guided Tour Groups' },
    { id: 'gate-c', name: 'Gate C', useFor: 'Family and Events' }
  ],
  activities: [
    { id: 'activity-ancient', name: 'Ancient Civilization Gallery Walk', slot: '10:00 AM', totalTickets: 80, linkedShowId: 'show-art' },
    { id: 'activity-science', name: 'Interactive Science Lab', slot: '12:30 PM', totalTickets: 70, linkedShowId: 'show-space' },
    { id: 'activity-kids', name: 'Kids Discovery Zone', slot: '01:30 PM', totalTickets: 60, linkedShowId: null },
    { id: 'activity-audio', name: 'Audio Guided Tour', slot: '03:30 PM', totalTickets: 90, linkedShowId: 'show-dino' },
    { id: 'activity-restoration', name: 'Live Restoration Demo', slot: '05:00 PM', totalTickets: 50, linkedShowId: null }
  ],
  ticketTypes: [
    { id: 'gate-entry', name: 'Gate Entry', price: 12, gate: 'gate-a' },
    { id: 'guided-tour', name: 'Guided Tour', price: 20, gate: 'gate-b' },
    { id: 'family-pass', name: 'Family Pass', price: 40, gate: 'gate-c' }
  ],
  shows: [
    { id: 'show-dino', name: 'Dinosaur Dome Show', time: '11:30', price: 8 },
    { id: 'show-space', name: 'Space Light Experience', time: '14:00', price: 10 },
    { id: 'show-art', name: 'Immersive Art Projection', time: '16:00', price: 9 }
  ]
};

const bookings = [];
const sessions = new Map();

function createSession(language = 'en') {
  const sessionId = uuidv4();
  const session = {
    id: sessionId,
    language,
    stage: 'idle',
    bookingDraft: {
      visitorName: '',
      email: '',
      date: '',
      quantity: 0,
      ticketType: '',
      showId: ''
    },
    latestBookingId: null
  };
  sessions.set(sessionId, session);
  return session;
}

function getSession(id, language = 'en') {
  if (!id || !sessions.has(id)) {
    return createSession(language);
  }
  const session = sessions.get(id);
  session.language = language || session.language;
  return session;
}

function findTicketPrice(ticketType, showId) {
  const base = ticketCatalog.ticketTypes.find((item) => item.id === ticketType)?.price || 0;
  const show = ticketCatalog.shows.find((item) => item.id === showId)?.price || 0;
  return base + show;
}

function getActivityAvailability() {
  return ticketCatalog.activities.map((activity) => {
    const bookedTickets = activity.linkedShowId
      ? bookings
        .filter((booking) => booking.showId === activity.linkedShowId)
        .reduce((sum, booking) => sum + booking.quantity, 0)
      : 0;

    return {
      id: activity.id,
      name: activity.name,
      slot: activity.slot,
      totalTickets: activity.totalTickets,
      bookedTickets,
      ticketsLeft: Math.max(activity.totalTickets - bookedTickets, 0)
    };
  });
}

function gateForTicket(ticketType) {
  const gateId = ticketCatalog.ticketTypes.find((item) => item.id === ticketType)?.gate;
  return ticketCatalog.gates.find((item) => item.id === gateId);
}

function extractDate(message) {
  const text = message.toLowerCase();
  if (/today/.test(text)) {
    return new Date().toISOString().split('T')[0];
  }
  if (/tomorrow/.test(text)) {
    const date = new Date();
    date.setDate(date.getDate() + 1);
    return date.toISOString().split('T')[0];
  }
  const directDate = message.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  return directDate ? directDate[1] : '';
}

function extractQuantity(message) {
  const match = message.match(/\b(\d{1,2})\b/);
  if (!match) return 0;
  const value = Number(match[1]);
  return Number.isNaN(value) ? 0 : value;
}

function extractEmail(message) {
  const match = message.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
  return match ? match[0] : '';
}

function extractTicketType(message) {
  const value = message.toLowerCase();
  if (value.includes('guided')) return 'guided-tour';
  if (value.includes('family')) return 'family-pass';
  if (value.includes('gate') || value.includes('entry') || value.includes('basic')) return 'gate-entry';
  return '';
}

function extractShow(message) {
  const value = message.toLowerCase();
  if (/(skip|no show|none)/.test(value)) return 'none';
  if (value.includes('dino')) return 'show-dino';
  if (value.includes('space')) return 'show-space';
  if (value.includes('art')) return 'show-art';
  return '';
}

function extractName(message) {
  const markerMatch = message.match(/(?:my name is|name is|i am|this is)\s+([A-Za-z][A-Za-z\s'.-]{1,60}?)(?=\s+[A-Za-z0-9._%+-]+@|\s+\d|$)/i);
  if (markerMatch?.[1]) {
    return markerMatch[1].replace(/\s+/g, ' ').trim();
  }

  let candidate = message;
  const emailIndex = candidate.search(/[A-Za-z0-9._%+-]+@/);
  if (emailIndex > 0) {
    candidate = candidate.slice(0, emailIndex);
  }

  const numberIndex = candidate.search(/\d/);
  if (numberIndex > 0) {
    candidate = candidate.slice(0, numberIndex);
  }

  candidate = candidate.replace(/[^A-Za-z\s'.-]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!candidate) return '';
  if (candidate.length > 60) return '';
  if (/^(book|ticket|pay|timing|show|schedule|gate|activity|today|tomorrow)$/i.test(candidate)) return '';

  return candidate;
}

function nextQuestionForMissingField(field) {
  if (field === 'visitorName') {
    return {
      reply: 'What is the visitor full name?',
      suggestions: ['My name is Alex Martin']
    };
  }
  if (field === 'email') {
    return {
      reply: 'Please share a valid email for your e-ticket.',
      suggestions: ['name@example.com']
    };
  }
  if (field === 'quantity') {
    return {
      reply: 'How many visitors are coming?',
      suggestions: ['1', '2', '4']
    };
  }
  if (field === 'date') {
    return {
      reply: 'Please share visit date in YYYY-MM-DD format, or say today/tomorrow.',
      suggestions: ['2026-04-10', 'tomorrow']
    };
  }
  if (field === 'ticketType') {
    return {
      reply: 'Choose ticket type: Gate Entry, Guided Tour, or Family Pass.',
      suggestions: ['Gate Entry', 'Guided Tour', 'Family Pass']
    };
  }
  if (field === 'showId') {
    return {
      reply: 'Would you like a show add-on? Reply with Dino, Space, Art, or Skip.',
      suggestions: ['Dino', 'Space', 'Art', 'Skip']
    };
  }
  return {
    reply: 'Please continue with booking details.',
    suggestions: []
  };
}

function draftMissingField(draft) {
  if (!draft.visitorName) return 'visitorName';
  if (!draft.email) return 'email';
  if (!draft.quantity) return 'quantity';
  if (!draft.date) return 'date';
  if (!draft.ticketType) return 'ticketType';
  if (draft.showId === '') return 'showId';
  return '';
}

function createBookingFromDraft(draft, language) {
  const showId = draft.showId === 'none' ? null : draft.showId;
  const pricePerTicket = findTicketPrice(draft.ticketType, showId);
  const totalAmount = Number(draft.quantity) * pricePerTicket;

  const booking = {
    id: uuidv4(),
    visitorName: draft.visitorName,
    email: draft.email,
    date: draft.date,
    quantity: Number(draft.quantity),
    ticketType: draft.ticketType,
    showId,
    language: language || 'en',
    pricePerTicket,
    totalAmount,
    status: 'created',
    paymentStatus: 'pending',
    createdAt: new Date().toISOString()
  };

  bookings.push(booking);
  return booking;
}

async function createCheckoutLink(booking) {
  if (stripe) {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: `Museum Booking (${booking.ticketType})`
            },
            unit_amount: Math.round(booking.totalAmount * 100)
          },
          quantity: 1
        }
      ],
      success_url: `${CLIENT_URL}/?payment=success&booking=${booking.id}`,
      cancel_url: `${CLIENT_URL}/?payment=cancelled&booking=${booking.id}`
    });

    booking.paymentStatus = 'checkout_created';
    booking.status = 'awaiting_payment';
    return { provider: 'stripe', checkoutUrl: session.url };
  }

  booking.paymentStatus = 'simulated_success';
  booking.status = 'confirmed';
  return {
    provider: 'mock',
    checkoutUrl: `${CLIENT_URL}/?payment=success&booking=${booking.id}`
  };
}

function getGeneralHelp() {
  return [
    'I can handle complete booking by chat.',
    'Ask museum timings, activities, schedules, and gate numbers.',
    'Try: "book 3 tickets", "timings", "activities", "show schedule", "pay".'
  ].join(' ');
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'museum-ticketing-chatbot' });
});

app.get('/api/catalog', (_req, res) => {
  res.json(ticketCatalog);
});

app.post('/api/chat', async (req, res) => {
  const { message = '', language = 'en', sessionId } = req.body;
  const session = getSession(sessionId, language);
  const lower = message.toLowerCase().trim();

  const replyPayload = {
    sessionId: session.id,
    reply: '',
    suggestions: [],
    checkoutUrl: null,
    intent: 'general'
  };

  if (!lower) {
    replyPayload.reply = getGeneralHelp();
    replyPayload.suggestions = ['Book tickets', 'Timings', 'Activities', 'Show schedule'];
    return res.json(replyPayload);
  }

  if (/(hello|hi|hey|hola|bonjour|namaste)/.test(lower)) {
    replyPayload.intent = 'greeting';
    replyPayload.reply = `Welcome to MuseumBot. Museum timings are ${ticketCatalog.openingHours}. ${getGeneralHelp()}`;
    replyPayload.suggestions = ['Book tickets', 'Museum timings', 'Activities', 'Show schedule'];
    return res.json(replyPayload);
  }

  if (/(timing|hours|open|close)/.test(lower)) {
    replyPayload.intent = 'timings';
    replyPayload.reply = `Museum is open daily from ${ticketCatalog.openingHours}. Last entry is 05:15 PM.`;
    replyPayload.suggestions = ['Book tickets', 'Show schedule', 'Gate info'];
    return res.json(replyPayload);
  }

  if (/(activities|things to do|what to do)/.test(lower)) {
    replyPayload.intent = 'activities';
    replyPayload.reply = `Today's activities: ${ticketCatalog.activities.map((activity) => `${activity.name} at ${activity.slot}`).join(', ')}.`;
    replyPayload.suggestions = ['Book guided tour', 'Show schedule'];
    return res.json(replyPayload);
  }

  if (/(schedule|show|event)/.test(lower)) {
    replyPayload.intent = 'schedule';
    replyPayload.reply = `Show schedule: ${ticketCatalog.shows.map((show) => `${show.name} at ${show.time}`).join(', ')}.`;
    replyPayload.suggestions = ['Book with dino show', 'Book with space show', 'Book with no show'];
    return res.json(replyPayload);
  }

  if (/(gate|entry gate|which gate)/.test(lower) && !/(book|ticket|reserve)/.test(lower)) {
    replyPayload.intent = 'gate_info';
    replyPayload.reply = `Gate details: ${ticketCatalog.gates.map((gate) => `${gate.name} for ${gate.useFor}`).join(', ')}.`;
    replyPayload.suggestions = ['Book gate entry', 'Book guided tour', 'Book family pass'];
    return res.json(replyPayload);
  }

  if (/\b(book|ticket|reserve|booking)\b/.test(lower) && session.stage === 'idle') {
    session.stage = 'collecting';
    session.bookingDraft = {
      visitorName: '',
      email: '',
      date: '',
      quantity: extractQuantity(lower),
      ticketType: extractTicketType(lower),
      showId: ''
    };

    replyPayload.intent = 'start_booking';
    replyPayload.reply = 'Great. Let us complete your booking in chat. What is your full name?';
    replyPayload.suggestions = ['My name is John Doe'];
    return res.json(replyPayload);
  }

  if (session.stage === 'collecting') {
    const draft = session.bookingDraft;

    if (/(cancel|reset|start over|new booking)/.test(lower)) {
      session.stage = 'idle';
      session.bookingDraft = {
        visitorName: '',
        email: '',
        date: '',
        quantity: 0,
        ticketType: '',
        showId: ''
      };
      replyPayload.reply = 'Booking cancelled. You can start again by typing "book tickets".';
      replyPayload.suggestions = ['Book tickets'];
      return res.json(replyPayload);
    }

    if (!draft.visitorName) {
      const parsedName = extractName(message);
      if (parsedName) {
        draft.visitorName = parsedName;
      }
    }

    if (!draft.email) {
      const parsedEmail = extractEmail(message);
      if (parsedEmail) {
        draft.email = parsedEmail;
      }
    }

    if (!draft.quantity) {
      const parsedQuantity = extractQuantity(message);
      if (parsedQuantity > 0 && parsedQuantity <= 20) {
        draft.quantity = parsedQuantity;
      }
    }

    if (!draft.date) {
      const parsedDate = extractDate(message);
      if (parsedDate) {
        draft.date = parsedDate;
      }
    }

    if (!draft.ticketType) {
      const parsedType = extractTicketType(message);
      if (parsedType) {
        draft.ticketType = parsedType;
      }
    }

    if (draft.showId === '') {
      const parsedShow = extractShow(message);
      if (parsedShow) {
        draft.showId = parsedShow;
      }
    }

    const missing = draftMissingField(draft);
    if (missing) {
      const next = nextQuestionForMissingField(missing);
      replyPayload.reply = next.reply;
      replyPayload.suggestions = next.suggestions;
      return res.json(replyPayload);
    }

    const booking = createBookingFromDraft(draft, session.language);
    session.latestBookingId = booking.id;
    session.stage = 'awaiting_payment';

    const gate = gateForTicket(booking.ticketType);
    const ticketName = ticketCatalog.ticketTypes.find((type) => type.id === booking.ticketType)?.name;
    const showName = booking.showId
      ? ticketCatalog.shows.find((show) => show.id === booking.showId)?.name
      : 'No Show Add-on';

    replyPayload.intent = 'booking_ready';
    replyPayload.reply = [
      `Booking created for ${booking.visitorName}.`,
      `Visitors: ${booking.quantity}, Date: ${booking.date}, Ticket: ${ticketName}, Show: ${showName}.`,
      `Assigned gate: ${gate ? gate.name : 'Gate A'}.`,
      `Total payable: $${booking.totalAmount}.`,
      'Type "pay" to proceed with payment.'
    ].join(' ');
    replyPayload.suggestions = ['pay'];
    return res.json(replyPayload);
  }

  if (session.stage === 'awaiting_payment' && /(pay|payment|checkout)/.test(lower)) {
    const booking = bookings.find((item) => item.id === session.latestBookingId);

    if (!booking) {
      session.stage = 'idle';
      replyPayload.reply = 'I could not find your active booking. Please start booking again.';
      replyPayload.suggestions = ['Book tickets'];
      return res.json(replyPayload);
    }

    try {
      const checkoutData = await createCheckoutLink(booking);
      replyPayload.intent = 'payment_link';
      replyPayload.checkoutUrl = checkoutData.checkoutUrl;
      replyPayload.reply = `Payment link generated via ${checkoutData.provider}. Open the link to complete payment.`;
      replyPayload.suggestions = ['Show schedule', 'Activities'];
      session.stage = 'idle';
      return res.json(replyPayload);
    } catch (error) {
      replyPayload.reply = `Payment creation failed: ${error.message}`;
      return res.status(500).json(replyPayload);
    }
  }

  if (/(pay|payment|checkout)/.test(lower)) {
    replyPayload.intent = 'payment_help';
    replyPayload.reply = 'To pay, first complete booking by saying: book tickets for 2 visitors.';
    replyPayload.suggestions = ['Book tickets'];
    return res.json(replyPayload);
  }

  replyPayload.reply = getGeneralHelp();
  replyPayload.suggestions = ['Book tickets', 'Museum timings', 'Activities', 'Show schedule'];
  return res.json(replyPayload);
});

app.get('/api/bookings', (_req, res) => {
  res.json(bookings);
});

app.get('/api/availability', (_req, res) => {
  res.json({
    openingHours: ticketCatalog.openingHours,
    activities: getActivityAvailability(),
    shows: ticketCatalog.shows
  });
});

app.post('/api/payments/confirm', (req, res) => {
  const { bookingId } = req.body;
  const booking = bookings.find((item) => item.id === bookingId);

  if (!booking) {
    return res.status(404).json({ message: 'Booking not found.' });
  }

  booking.paymentStatus = 'paid';
  booking.status = 'confirmed';
  return res.json({ message: 'Booking payment confirmed.', booking });
});

app.get('/api/analytics/summary', (_req, res) => {
  const totalBookings = bookings.length;
  const totalRevenue = bookings
    .filter((booking) => booking.paymentStatus === 'paid' || booking.paymentStatus === 'simulated_success' || booking.status === 'confirmed')
    .reduce((sum, booking) => sum + booking.totalAmount, 0);

  const byTicketType = ticketCatalog.ticketTypes.map((type) => ({
    ticketType: type.name,
    bookings: bookings.filter((booking) => booking.ticketType === type.id).length
  }));

  const byShow = ticketCatalog.shows.map((show) => ({
    show: show.name,
    bookings: bookings.filter((booking) => booking.showId === show.id).length
  }));

  res.json({
    totalBookings,
    totalRevenue,
    byTicketType,
    byShow,
    generatedAt: new Date().toISOString()
  });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
