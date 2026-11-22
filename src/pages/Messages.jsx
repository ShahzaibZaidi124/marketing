import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { AlertCircle, Loader2, MessageCircle, RefreshCw, Send, ShieldAlert, UserRound } from "lucide-react";
import { useAuth } from "../context/AuthContext.jsx";
import {
  formatMessageTime,
  getConversationMessages,
  getMessagesLoadErrorMessage,
  getMyConversation,
  getSendMessageErrorMessage,
  initialsFor,
  markMessagesRead,
  maximumMessageLength,
  sendMessage,
  sortMessages,
  validateMessageDraft,
} from "../lib/messages.js";

const ownerName = "NexTech";

function Avatar({ name, className = "" }) {
  return (
    <span className={`messages-avatar ${className}`} aria-hidden="true">
      {initialsFor(name) || <UserRound size={16} />}
    </span>
  );
}

export default function Messages() {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const [status, setStatus] = useState("loading");
  const [loadError, setLoadError] = useState("");
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState("");
  const [notice, setNotice] = useState("");
  const threadEndRef = useRef(null);

  // Reads use the signed-in session only: RLS limits the conversations and
  // messages tables to rows where customer_id = auth.uid().
  const fetchThread = useCallback(async () => {
    if (!userId) return { conversation: null, messages: [] };
    const nextConversation = await getMyConversation(userId);
    const nextMessages = nextConversation ? await getConversationMessages(nextConversation.id) : [];
    return { conversation: nextConversation, messages: sortMessages(nextMessages) };
  }, [userId]);

  const loadThread = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setStatus("loading");
    setLoadError("");
    try {
      const { conversation: nextConversation, messages: nextMessages } = await fetchThread();
      setMessages(nextMessages);
      setStatus("ready");
      if (!nextConversation) return;

      // Read receipts are best effort; a failure never blocks the thread.
      try {
        const { markedRead } = await markMessagesRead({ conversationId: nextConversation.id });
        if (markedRead > 0) {
          const stampedAt = new Date().toISOString();
          setMessages((current) => current.map((message) => (
            message.sender_role === "owner" && !message.read_at ? { ...message, read_at: stampedAt } : message
          )));
        }
      } catch {
        /* ignore read-receipt failures */
      }
    } catch (error) {
      setLoadError(getMessagesLoadErrorMessage(error));
      setStatus("error");
    }
  }, [fetchThread]);

  useEffect(() => {
    void loadThread();
  }, [loadThread]);

  useEffect(() => {
    if (status !== "ready") return;
    threadEndRef.current?.scrollIntoView({ block: "end" });
  }, [status, messages.length]);

  const handleSend = async (event) => {
    event.preventDefault();
    if (sending) return;
    const { value, error } = validateMessageDraft(draft);
    if (error) {
      setSendError(error);
      return;
    }

    setSending(true);
    setSendError("");
    setNotice("");
    try {
      // Writes go through the send-message Edge Function, which derives the
      // customer identity from the verified JWT and creates the conversation on
      // the first message. The customer path never accepts a conversation id,
      // so one customer can never post into another customer's thread.
      await sendMessage({ body: value });
      setDraft("");
      setNotice("Message sent to the NexTech team.");
      await loadThread({ silent: true });
    } catch (sendFailure) {
      setSendError(getSendMessageErrorMessage(sendFailure));
    } finally {
      setSending(false);
    }
  };

  const characterCount = Array.from(draft).length;

  return (
    <main className="messages-page">
      <header className="messages-heading">
        <div>
          <span className="market-eyebrow">NEXTECH MESSAGES</span>
          <h1>Messages</h1>
          <p>Talk directly with the NexTech team about your project.</p>
        </div>
      </header>

      {status === "loading" && (
        <div className="messages-loading" role="status">
          <Loader2 className="messages-spinner" size={17} aria-hidden="true" />
          <span>Loading your conversation…</span>
        </div>
      )}

      {status === "error" && (
        <div className="messages-error-state" role="alert">
          <span className="messages-error-icon"><ShieldAlert size={19} aria-hidden="true" /></span>
          <div>
            <strong>We couldn’t load your messages</strong>
            <p>{loadError}</p>
          </div>
          <button type="button" className="messages-retry-button" onClick={() => void loadThread()}>
            <RefreshCw size={14} aria-hidden="true" /> Try again
          </button>
        </div>
      )}

      {status === "ready" && (
        <section className="messages-layout messages-layout-single" aria-label="Conversation with NexTech">
          <section className="messages-chat">
            <header className="messages-chat-header">
              <Avatar name={ownerName} />
              <div className="messages-chat-person">
                <strong>{ownerName} owner</strong>
                <span>Website owner · Replies to your project questions</span>
              </div>
              <div className="messages-header-actions">
                <button type="button" onClick={() => void loadThread({ silent: true })} aria-label="Refresh conversation">
                  <RefreshCw size={14} aria-hidden="true" /><span>Refresh</span>
                </button>
              </div>
            </header>

            <div className="messages-thread" aria-live="polite" aria-label="Conversation messages">
              {messages.length === 0 ? (
                <div className="messages-thread-empty">
                  <MessageCircle size={20} aria-hidden="true" />
                  <p>No messages yet.</p>
                  <span>Write below to start the conversation. Only you and the NexTech owner can read it.</span>
                </div>
              ) : (
                <>
                  {messages.map((message) => {
                    const ownMessage = message.sender_role === "customer";
                    return (
                      <article className={`messages-bubble-row${ownMessage ? " own" : ""}`} key={message.id}>
                        {!ownMessage && <Avatar name={ownerName} className="messages-avatar-small" />}
                        <div className="messages-bubble-wrap">
                          <span className="messages-bubble-author">{ownMessage ? "You" : ownerName}</span>
                          <div className="messages-bubble"><p>{message.body}</p></div>
                          <span className="messages-bubble-meta">
                            <time>{formatMessageTime(message.created_at)}</time>
                            {ownMessage && message.read_at && <span className="messages-read-state">Read</span>}
                          </span>
                        </div>
                      </article>
                    );
                  })}
                  <div ref={threadEndRef} />
                </>
              )}
            </div>

            <form className="messages-composer" onSubmit={handleSend}>
              {sendError && <p className="messages-error" role="alert">{sendError}</p>}
              {notice && <p className="messages-action-notice" role="status">{notice}</p>}
              <label className="messages-compose-input">
                <span className="visually-hidden">Write a message</span>
                <textarea
                  value={draft}
                  onChange={(event) => { setDraft(event.target.value); if (sendError) setSendError(""); }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      event.currentTarget.form?.requestSubmit();
                    }
                  }}
                  maxLength={maximumMessageLength}
                  rows={2}
                  placeholder="Write a message to the NexTech team…"
                  disabled={sending}
                />
                <span>{characterCount}/{maximumMessageLength}</span>
              </label>
              <div className="messages-compose-actions">
                <span className="messages-attachment-help"><AlertCircle size={13} aria-hidden="true" /> Attachments are not available yet.</span>
                <button className="market-button market-button-primary messages-send-button" type="submit" disabled={sending} aria-busy={sending}>
                  {sending ? "Sending…" : "Send"} <Send size={14} aria-hidden="true" />
                </button>
              </div>
            </form>
          </section>
        </section>
      )}

      <div className="messages-page-footer">
        <Link to="/services">Back to services</Link>
      </div>
    </main>
  );
}
