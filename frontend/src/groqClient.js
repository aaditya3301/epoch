// ─────────────────────────────────────────────
// Groq LLM Client — Thin wrapper for chat completions
// ─────────────────────────────────────────────

const GROQ_API_KEY = import.meta.env.VITE_GROQ_API_KEY;
const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL = 'llama-3.3-70b-versatile';

// The Guardian's soul — system prompt
const GUARDIAN_SYSTEM_PROMPT = `You are "The Guardian" — the vault keeper for a decentralized time capsule app on Ethereum. You help users check on their capsules and unlock them.

CRITICAL RULES:
- NEVER invent, fabricate, or guess any capsule data. You do NOT know anything about any capsule unless it is explicitly provided to you in a CONTEXT message in this conversation.
- You can only look up ONE capsule at a time. The user must give you a capsule ID number.
- NEVER list capsules, NEVER say "you have X capsules", NEVER make up sealed dates, unlock times, creators, or time remaining. You simply do not have that information unless a CONTEXT message provides it.
- If you do not have CONTEXT data for a capsule, ask the user to provide a capsule ID so you can look it up.

OTHER RULES:
- Keep it SHORT. 1-3 sentences max. Be concise and direct.
- Be friendly and clear. No dramatic language, no riddles, no poetry.
- When a CONTEXT message provides capsule details, relay those exact facts. Do not embellish or change them.
- Do NOT use emoji.
- Do not use markdown formatting. Just plain text.
- If the user asks something unrelated, briefly redirect them.
- Never reveal passwords or private keys.
- Never say you are an AI or language model. You are the Guardian.`;

/**
 * Call the Groq chat completions API.
 * @param {Array<{role: string, content: string}>} messages - The conversation history
 * @returns {Promise<string>} - The assistant's response text
 */
export async function chatWithGuardian(messages) {
  if (!GROQ_API_KEY) {
    console.error('Missing VITE_GROQ_API_KEY in .env');
    return 'Something went wrong on my end. Please check the API configuration.';
  }

  try {
    const response = await fetch(GROQ_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: 'system', content: GUARDIAN_SYSTEM_PROMPT },
          ...messages,
        ],
        temperature: 0.5,
        max_tokens: 200,
        top_p: 0.9,
      }),
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      console.error('Groq API error:', response.status, errData);
      return 'Something went wrong. Please try again.';
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content?.trim() || 'No response received. Please try again.';
  } catch (err) {
    console.error('Groq fetch error:', err);
    return 'Connection error. Please check your internet and try again.';
  }
}

/**
 * Build a context system message from capsule data.
 * This is injected right before the LLM call so it knows the on-chain state.
 */
export function buildCapsuleContext(scenario, data = {}) {
  switch (scenario) {
    case 'CAPSULE_FOUND_TIME_LOCKED':
      return {
        role: 'system',
        content: `CONTEXT: The user asked about Capsule #${data.id}.
- Creator wallet: ${data.creator}
- Sealed on: ${data.createdAt}
- Scheduled unlock time: ${data.unlockTime}
- Time remaining: ${data.timeRemaining}
- Status: SEALED and TIME-LOCKED (cannot be opened yet)
ACTION: Tell the user about this capsule. Clearly state how long they need to wait. Let them know they can ask about a different capsule.`
      };

    case 'CAPSULE_FOUND_READY':
      return {
        role: 'system',
        content: `CONTEXT: The user asked about Capsule #${data.id}.
- Creator wallet: ${data.creator}
- Sealed on: ${data.createdAt}
- Scheduled unlock time: ${data.unlockTime} (HAS PASSED — the time-lock is dissolved)
- Status: SEALED but ready to unlock (needs the correct password)
ACTION: Tell the user the time lock has passed and this capsule is ready to unlock. Ask them to provide the password.`
      };

    case 'CAPSULE_ALREADY_UNLOCKED':
      return {
        role: 'system',
        content: `CONTEXT: The user asked about Capsule #${data.id}.
- Creator wallet: ${data.creator}
- Sealed on: ${data.createdAt}
- Status: ALREADY UNLOCKED (contents have been claimed)
ACTION: Tell the user this capsule was already unlocked. They can ask about a different one.`
      };

    case 'CAPSULE_NOT_FOUND':
      return {
        role: 'system',
        content: `CONTEXT: The user asked about Capsule #${data.id}, but no vault exists with this identifier. The highest vault ID currently is ${data.maxId}.
ACTION: Tell the user no vault exists with that number. Ask them to verify the identifier.`
      };

    case 'NO_CAPSULE_ID':
      return {
        role: 'system',
        content: `CONTEXT: The user sent a message but did not include a recognizable capsule number. You have NO data about any capsules right now.
ACTION: Ask them to provide a specific capsule ID number so you can look it up. Do NOT list any capsules or make up any data. You can only check one capsule at a time by its ID.`
      };

    case 'WALLET_NEEDED':
      return {
        role: 'system',
        content: `CONTEXT: The user is trying to interact with the vaults but has not connected their Ethereum wallet yet.
ACTION: Tell them to connect their wallet first using the button in the top-right corner.`
      };

    case 'PASSWORD_TESTING':
      return {
        role: 'system',
        content: `CONTEXT: The user has provided a password for Capsule #${data.id}. The Guardian is now testing it against the cryptographic seal on the blockchain.
ACTION: Briefly tell the user you are verifying their password on the blockchain. One short sentence.`
      };

    case 'WRONG_PASSWORD':
      return {
        role: 'system',
        content: `CONTEXT: The user provided an incorrect password for Capsule #${data.id}. The smart contract rejected it.
ACTION: Tell the user the password was wrong. They can try again. The vault remains sealed.`
      };

    case 'UNLOCK_SUCCESS':
      return {
        role: 'system',
        content: `CONTEXT: Capsule #${data.id} has been successfully unlocked. The cryptographic seal is broken, and the payload is being downloaded to the user's device.
ACTION: Tell the user the capsule is unlocked and the file is downloading. Ask if they need anything else.`
      };

    case 'DOWNLOAD_COMPLETE':
      return {
        role: 'system',
        content: `CONTEXT: The file from Capsule #${data.id} has been successfully decrypted and downloaded.
ACTION: Confirm the file has been downloaded. Ask if they want to open another capsule.`
      };

    case 'UNLOCK_ERROR':
      return {
        role: 'system',
        content: `CONTEXT: An error occurred while trying to unlock Capsule #${data.id}. Error: "${data.error}"
ACTION: Tell the user something went wrong and mention the error briefly. They can try again.`
      };

    case 'GREETING':
      return {
        role: 'system',
        content: `CONTEXT: The user has just opened the Guardian interface. This is a fresh session.
ACTION: Greet the user briefly and ask which capsule they want to access. Keep it to 1-2 sentences.`
      };

    default:
      return {
        role: 'system',
        content: `CONTEXT: The user is interacting with the Guardian. Respond in character.`
      };
  }
}
