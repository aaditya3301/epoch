import React, { useState, useEffect, useRef } from 'react';
import { ethers } from 'ethers';
import CryptoJS from 'crypto-js';

// ─────────────────────────────────────────────
// Guardian Personality — Message Templates
// ─────────────────────────────────────────────
const GREETINGS = [
    "I am the Guardian of forgotten epochs.\nState your claim — which vault do you seek?",
    "The vaults hum in silence, waiting for their rightful claimant.\nSpeak the number of the one you wish to reclaim.",
    "You stand before the threshold of sealed time.\nWhich vault calls to you, seeker?"
];

const MESSAGES = {
    capsuleFound: (id, creator, date) =>
        `Vault **${id}**… sealed by \`${creator}\` on ${date}.\nLet me consult the temporal seal…`,

    timeLocked: (days, hours, mins) => {
        let timeStr = '';
        if (days > 0) timeStr += `${days} day${days !== 1 ? 's' : ''}`;
        if (hours > 0) timeStr += `${timeStr ? ', ' : ''}${hours} hour${hours !== 1 ? 's' : ''}`;
        if (mins > 0 && days === 0) timeStr += `${timeStr ? ', ' : ''}${mins} minute${mins !== 1 ? 's' : ''}`;
        if (!timeStr) timeStr = 'moments';
        return `Patience, seeker. This vault remains bound by time.\nYou must wait **${timeStr}** before the seal dissolves.\n\nReturn when the moment arrives. Or speak another vault number.`;
    },

    readyForPassword:
        "The time-lock has dissolved.\nBut the **cryptographic seal** remains.\n\nSpeak the password to shatter it.",

    wrongPassword:
        "The seal rejects your words. The incantation is incorrect.\nTry again, seeker — or the vault stays sealed forever.",

    unlockSuccess:
        "The seal is broken.\n\nYour payload emerges from the depths of the chain…\nDownloading your artifact now.",

    alreadyUnlocked:
        "This vault has already been claimed.\nIts contents have been released. There is nothing left to retrieve.\n\nSpeak another vault number if you seek elsewhere.",

    notFound:
        "I sense no vault bearing that identifier.\nAre you certain of the number, seeker?",

    noId:
        "I need a vault number to proceed.\nSpeak it plainly — for example: *\"Capsule 7\"* or simply *\"7\"*.",

    walletNeeded:
        "You must connect your wallet before approaching the vaults.\nThe chain cannot verify your intent without it.",

    error: (msg) =>
        `A disturbance ripples through the chain…\n\n\`${msg}\`\n\nTry again, seeker.`,

    farewell:
        "The vault is resealed. Until next time, seeker.",
};

// ─────────────────────────────────────────────
// Helper: extract capsule ID from natural text
// ─────────────────────────────────────────────
function extractCapsuleId(text) {
    const cleaned = text.trim();
    // Match patterns: "capsule 45", "vault #3", "#12", "id 7", or bare numbers
    const patterns = [
        /(?:capsule|vault|id|epoch|#)\s*#?(\d+)/i,
        /^(\d+)$/  // bare number
    ];
    for (const pattern of patterns) {
        const match = cleaned.match(pattern);
        if (match) return parseInt(match[1], 10);
    }
    return null;
}

// ─────────────────────────────────────────────
// Helper: format a unix timestamp to readable
// ─────────────────────────────────────────────
function formatDate(unixTimestamp) {
    return new Date(Number(unixTimestamp) * 1000).toLocaleDateString('en-US', {
        year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
    });
}

// ─────────────────────────────────────────────
// Guardian Component
// ─────────────────────────────────────────────
export default function Guardian({ contract, provider, signer, onClose, isActive }) {
    const [messages, setMessages] = useState([]);
    const [input, setInput] = useState('');
    const [guardianState, setGuardianState] = useState('GREETING');
    const [currentCapsuleId, setCurrentCapsuleId] = useState(null);
    const [isProcessing, setIsProcessing] = useState(false);
    const messagesEndRef = useRef(null);
    const inputRef = useRef(null);
    const hasGreeted = useRef(false);

    // Auto-scroll to bottom
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    // Focus input when modal opens
    useEffect(() => {
        if (isActive) {
            setTimeout(() => inputRef.current?.focus(), 400);
        }
    }, [isActive]);

    // Greet on first open
    useEffect(() => {
        if (isActive && !hasGreeted.current) {
            hasGreeted.current = true;
            const greeting = GREETINGS[Math.floor(Math.random() * GREETINGS.length)];
            addGuardianMessage(greeting, true);
            setGuardianState('AWAITING_ID');
        }
    }, [isActive]);

    // Reset when modal closes
    useEffect(() => {
        if (!isActive) {
            setMessages([]);
            setGuardianState('GREETING');
            setCurrentCapsuleId(null);
            setInput('');
            setIsProcessing(false);
            hasGreeted.current = false;
        }
    }, [isActive]);

    function addGuardianMessage(text, animated = false) {
        setMessages(prev => [...prev, { role: 'guardian', text, animated }]);
    }

    function addUserMessage(text) {
        setMessages(prev => [...prev, { role: 'user', text }]);
    }

    function addThinkingMessage() {
        setMessages(prev => [...prev, { role: 'thinking', text: '' }]);
    }

    function removeThinkingMessage() {
        setMessages(prev => prev.filter(m => m.role !== 'thinking'));
    }

    // ─────────────────────────────────────
    // Main message processor (state machine)
    // ─────────────────────────────────────
    async function processMessage(text) {
        addUserMessage(text);
        setInput('');
        setIsProcessing(true);
        addThinkingMessage();

        // Small delay for natural feel
        await new Promise(r => setTimeout(r, 600));

        try {
            switch (guardianState) {
                case 'AWAITING_ID':
                    await handleAwaitingId(text);
                    break;

                case 'AWAITING_PASSWORD':
                    await handleAwaitingPassword(text);
                    break;

                default:
                    removeThinkingMessage();
                    addGuardianMessage(MESSAGES.noId);
                    setGuardianState('AWAITING_ID');
            }
        } catch (err) {
            console.error('Guardian error:', err);
            removeThinkingMessage();
            addGuardianMessage(MESSAGES.error(err.reason || err.message || 'Unknown error'));
            // Reset to awaiting ID so user can try again
            setGuardianState('AWAITING_ID');
        } finally {
            setIsProcessing(false);
        }
    }

    // ─────────────────────────────────────
    // State: AWAITING_ID
    // ─────────────────────────────────────
    async function handleAwaitingId(text) {
        if (!contract || !provider) {
            removeThinkingMessage();
            addGuardianMessage(MESSAGES.walletNeeded);
            return;
        }

        const capsuleId = extractCapsuleId(text);

        if (capsuleId === null) {
            removeThinkingMessage();
            addGuardianMessage(MESSAGES.noId);
            return;
        }

        // Check if capsule exists by reading nextCapsuleId
        const nextId = await contract.nextCapsuleId();
        if (capsuleId >= Number(nextId)) {
            removeThinkingMessage();
            addGuardianMessage(MESSAGES.notFound);
            return;
        }

        // Query on-chain capsule data
        const capsule = await contract.capsules(capsuleId);
        const creator = capsule[0];
        const unlockTime = Number(capsule[2]);
        const createdAt = Number(capsule[3]);
        const unlocked = capsule[5];

        const shortCreator = `${creator.substring(0, 6)}…${creator.substring(creator.length - 4)}`;
        const dateStr = formatDate(createdAt);

        removeThinkingMessage();

        // Show the "found" message first
        addGuardianMessage(MESSAGES.capsuleFound(capsuleId, shortCreator, dateStr));

        // Small pause before the verdict
        await new Promise(r => setTimeout(r, 1200));
        addThinkingMessage();
        await new Promise(r => setTimeout(r, 800));
        removeThinkingMessage();

        // Check if already unlocked
        if (unlocked) {
            addGuardianMessage(MESSAGES.alreadyUnlocked);
            setGuardianState('AWAITING_ID');
            return;
        }

        // Check time lock. Use on-chain block timestamp for accuracy
        const block = await provider.getBlock('latest');
        const currentTime = block.timestamp;
        const timeRemaining = unlockTime - Number(currentTime);

        if (timeRemaining > 0) {
            const days = Math.floor(timeRemaining / 86400);
            const hours = Math.floor((timeRemaining % 86400) / 3600);
            const mins = Math.floor((timeRemaining % 3600) / 60);
            addGuardianMessage(MESSAGES.timeLocked(days, hours, mins));
            setGuardianState('AWAITING_ID');
            return;
        }

        // Time has passed — ask for password
        setCurrentCapsuleId(capsuleId);
        addGuardianMessage(MESSAGES.readyForPassword);
        setGuardianState('AWAITING_PASSWORD');
    }

    // ─────────────────────────────────────
    // State: AWAITING_PASSWORD
    // ─────────────────────────────────────
    async function handleAwaitingPassword(text) {
        const password = text.trim();

        if (!password) {
            removeThinkingMessage();
            addGuardianMessage("You must speak the password, seeker. The seal awaits your words.");
            return;
        }

        // Check if user changed their mind and is providing a new capsule ID
        const maybeNewId = extractCapsuleId(text);
        if (maybeNewId !== null && text.toLowerCase().includes('capsule') || text.toLowerCase().includes('vault')) {
            removeThinkingMessage();
            addGuardianMessage("Abandoning the current vault… Let me look up the new one.");
            await new Promise(r => setTimeout(r, 500));
            setGuardianState('AWAITING_ID');
            await handleAwaitingId(text);
            return;
        }

        removeThinkingMessage();
        addGuardianMessage("Testing the cryptographic seal…");

        await new Promise(r => setTimeout(r, 400));
        addThinkingMessage();

        try {
            // Call the unlock function on the contract (this costs gas)
            const tx = await contract.unlock(currentCapsuleId, password);
            await tx.wait();

            removeThinkingMessage();
            addGuardianMessage(MESSAGES.unlockSuccess);

            // Now fetch and decrypt from IPFS
            await new Promise(r => setTimeout(r, 800));
            addThinkingMessage();

            const capsule = await contract.capsules(currentCapsuleId);
            const ipfsCID = capsule[1];

            const ipfsRes = await fetch(`https://gateway.pinata.cloud/ipfs/${ipfsCID}`);
            if (!ipfsRes.ok) throw new Error('Failed to retrieve payload from the decentralized archive.');
            const encryptedFile = await ipfsRes.text();

            const decryptedBytes = CryptoJS.AES.decrypt(encryptedFile, password);
            const decryptedDataUrl = decryptedBytes.toString(CryptoJS.enc.Utf8);

            if (!decryptedDataUrl) throw new Error("Decryption produced no output — the password may be subtly wrong.");

            // Trigger download
            const a = document.createElement('a');
            a.href = decryptedDataUrl;
            a.download = `Epoch_${currentCapsuleId}_unlocked`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);

            removeThinkingMessage();
            addGuardianMessage("Your artifact has been delivered.\nThe vault is now empty. Is there another vault you seek?");
            setCurrentCapsuleId(null);
            setGuardianState('AWAITING_ID');

        } catch (err) {
            removeThinkingMessage();
            console.error('Unlock error:', err);

            // Check if it's a password error from the contract
            const reason = err.reason || err.message || '';
            if (reason.includes('Bad Pass') || reason.includes('password') || reason.includes('revert')) {
                addGuardianMessage(MESSAGES.wrongPassword);
                // Stay in AWAITING_PASSWORD so they can retry
            } else if (reason.includes('Too early')) {
                addGuardianMessage("The temporal seal is still active. The chain does not lie — you must wait.");
                setGuardianState('AWAITING_ID');
            } else if (reason.includes('Unlocked')) {
                addGuardianMessage(MESSAGES.alreadyUnlocked);
                setGuardianState('AWAITING_ID');
            } else {
                addGuardianMessage(MESSAGES.error(reason));
                setGuardianState('AWAITING_ID');
            }
        }
    }

    // ─────────────────────────────────────
    // Send handler
    // ─────────────────────────────────────
    function handleSend(e) {
        e?.preventDefault();
        const text = input.trim();
        if (!text || isProcessing) return;
        processMessage(text);
    }

    function handleKeyDown(e) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    }

    // ─────────────────────────────────────
    // Render
    // ─────────────────────────────────────
    return (
        <div className="guardian-modal" onClick={(e) => e.stopPropagation()}>
            {/* Header */}
            <div className="guardian-header">
                <div className="guardian-identity">
                    <div className="guardian-avatar">
                        <div className="guardian-avatar-glow"></div>
                        <svg className="guardian-avatar-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M12 2L3 7V12C3 17.25 6.75 22.08 12 23C17.25 22.08 21 17.25 21 12V7L12 2Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="rgba(108, 92, 231, 0.15)" />
                            <path d="M12 8V13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                            <circle cx="12" cy="16" r="0.75" fill="currentColor" />
                        </svg>
                    </div>
                    <div className="guardian-info">
                        <span className="guardian-name">The Guardian</span>
                        <span className="guardian-status">
                            <span className="status-dot"></span>
                            Watching the vaults
                        </span>
                    </div>
                </div>
                <button className="close-btn" onClick={onClose}>×</button>
            </div>

            {/* Messages */}
            <div className="chat-messages">
                {messages.map((msg, i) => {
                    if (msg.role === 'thinking') {
                        return (
                            <div key={`thinking-${i}`} className="chat-message guardian thinking">
                                <div className="typing-indicator">
                                    <span></span><span></span><span></span>
                                </div>
                            </div>
                        );
                    }

                    return (
                        <div
                            key={i}
                            className={`chat-message ${msg.role === 'guardian' ? 'guardian' : 'user'}`}
                        >
                            {msg.text.split('\n').map((line, j) => (
                                <span key={j}>
                                    {renderFormattedText(line)}
                                    {j < msg.text.split('\n').length - 1 && <br />}
                                </span>
                            ))}
                        </div>
                    );
                })}
                <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <form className="chat-input-area" onSubmit={handleSend}>
                <input
                    ref={inputRef}
                    type="text"
                    className="chat-input"
                    placeholder={
                        guardianState === 'AWAITING_PASSWORD'
                            ? 'Enter the decryption password…'
                            : 'Speak to the Guardian…'
                    }
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    disabled={isProcessing}
                    autoComplete="off"
                />
                <button
                    type="submit"
                    className="chat-send-btn"
                    disabled={isProcessing || !input.trim()}
                >
                    ➤
                </button>
            </form>
        </div>
    );
}

// Simple markdown-like text formatting (bold, code, italic)
function renderFormattedText(text) {
    // Process **bold**, `code`, and *italic*
    const parts = [];
    let remaining = text;
    let key = 0;

    while (remaining.length > 0) {
        // Bold **text**
        const boldMatch = remaining.match(/\*\*(.+?)\*\*/);
        // Code `text`
        const codeMatch = remaining.match(/`(.+?)`/);
        // Italic *text*
        const italicMatch = remaining.match(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/);

        const matches = [
            boldMatch && { type: 'bold', match: boldMatch, index: boldMatch.index },
            codeMatch && { type: 'code', match: codeMatch, index: codeMatch.index },
            italicMatch && { type: 'italic', match: italicMatch, index: italicMatch.index },
        ].filter(Boolean).sort((a, b) => a.index - b.index);

        if (matches.length === 0) {
            parts.push(<span key={key++}>{remaining}</span>);
            break;
        }

        const first = matches[0];
        if (first.index > 0) {
            parts.push(<span key={key++}>{remaining.substring(0, first.index)}</span>);
        }

        if (first.type === 'bold') {
            parts.push(<strong key={key++}>{first.match[1]}</strong>);
        } else if (first.type === 'code') {
            parts.push(<code key={key++} className="guardian-code">{first.match[1]}</code>);
        } else if (first.type === 'italic') {
            parts.push(<em key={key++}>{first.match[1]}</em>);
        }

        remaining = remaining.substring(first.index + first.match[0].length);
    }

    return parts;
}
