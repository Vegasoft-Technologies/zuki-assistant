export const RESERVATION_OFFER = "I'm sorry, I can't make reservations. Would you like me to transfer you to someone who can help?";
export const CLARIFY_OFFER = "I want to make sure I give you the right answer. Could you rephrase that for me? I can also put you through to a team member if you prefer.";
export const FIRST_MESSAGE = "Hi, thanks for calling Zuki's. I'm the café's automated assistant. How can I help you today?";
export const DELIBERATE_OFFER = "That's something a member of our team can help you with. Would you like me to connect you?";
export const LOOKUP_ERROR_OFFER = "Sorry, I'm having trouble checking that right now. Would you like me to connect you with a member of our team?";
export const CONFIRMATION = "Just to confirm, would you like me to transfer you to a member of our team?";
export const TRANSFER_FAILURE = "I'm sorry, I couldn't connect you to someone right now. Please try again later.";

export const PHRASES = {
  yes: ["yes", "yes please", "yeah", "yep", "yes please transfer me"],
  confirmation: ["yes", "yeah", "yep", "sure", "okay", "ok", "go ahead", "please", "thanks", "thank you", "that'd be lovely", "that'd be great", "that'd be nice", "that'd be perfect", "great", "nice", "perfect"],
  no: ["no", "nope", "no thanks", "no thank you", "not now", "that's fine"],
  declineStart: ["no thanks", "nope", "nah", "not", "no"],
  questionWords: ["where", "what", "when", "how", "do you", "is there", "can i"],
  human: ["human", "person", "someone", "staff", "manager", "advisor", "real person", "operator"],
  humanOnly: ["human", "operator", "real person"],
  humanRequest: ["speak to", "talk to", "put me through to", "connect me to", "transfer me to"],
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
