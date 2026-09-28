export const RESERVATION_OFFER = "I'm sorry, I can't make reservations. Would you like me to transfer you to someone who can help?";
export const TRANSFER_FAILURE = "I'm sorry, I couldn't connect you to someone right now. Please try again later.";

export const PHRASES = {
  yes: ["yes", "yeah", "yep", "sure", "please", "yes please", "ok", "okay", "go ahead"],
  no: ["no", "nope", "no thanks", "no thank you", "not now", "that's fine"],
  human: ["human", "person", "someone", "staff", "manager", "advisor", "real person", "operator"],
  humanOnly: ["human", "operator", "real person"],
  humanRequest: ["speak to", "talk to", "put me through to", "connect me to"],
  reservation: ["book", "booking", "reserve", "reservation", "reservations", "hold a table"],
  greeting: ["hello", "hi", "hey", "good morning", "good afternoon", "good evening"],
  goodbye: ["thanks", "thank you", "thank you so much", "cheers", "bye", "goodbye"],
  acknowledgement: ["ok", "okay", "alright", "great", "perfect", "lovely", "cool", "got it", "no", "that's it", "that's all", "nothing else"],
  filler: ["", "um", "uh", "hmm", "sorry", "sorry what", "pardon", "what", "huh", "come again", "can you repeat that", "say that again", "i didn't catch that", "what did you say"],
} as const;

export const REPLIES = {
  declined: "No problem.",
  greeting: "Hello! How can I help you?",
  goodbye: "You're welcome. Goodbye!",
  filler: "Sorry, could you say that again?",
} as const;
