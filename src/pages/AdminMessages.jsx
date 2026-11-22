import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowLeft,
  Loader2,
  MessageCircle,
  RefreshCw,
  Search,
  Send,
  ShieldAlert,
  UserRound,
  X,
} from "lucide-react";
import {
  countUnreadCustomerMessages,
  formatMessageTime,
  getConversationMessages,
  getCustomerProfiles,
  getMessagesLoadErrorMessage,
  getOwnerConversations,
  getSendMessageErrorMessage,
  getUnreadCustomerMessages,
  initialsFor,
  markMessagesRead,
  maximumMessageLength,
  resolveCustomerName,
  sendMessage,
  sortConversationsByRecency,
  sortMessages,
  validateMessageDraft,
} from "../lib/messages.js";

function Avatar({ name, className = "" }) {
  return (
    <span className={`messages-avatar ${className}`} aria-hidden="true">
      {initialsFor(name) || <UserRound size={16} />}
    </span>
  );
}

// Owner inbox. Every row is loaded through RLS, which only returns conversations
// for the owner, and every reply goes through the send-message Edge Function that
// re-checks owner_accounts on the server.
export default function AdminMessages() {
  const [status, setStatus] = useState("loading");
  const [loadError, setLoadError] = useState("");
  const [conversations, setConversations] = useState([]);
  const [unreadCounts, setUnreadCounts] = useState(() => new Map());
  const [profiles, setProfiles] = useState(() => new Map());
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState(null);
  const [mobileChatOpen, setMobileChatOpen] = useState(false);

  const [threadStatus, setThreadStatus] = useState("idle");
  const [threadError, setThreadError] = useState("");
  const [messages, setMessages] = useState([]);

  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState("");
  const [notice, setNotice] = useState("");
  const threadEndRef = useRef(null);

  const loadInbox = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setStatus("loading");
    setLoadError("");
    try {
      const [nextConversations, unread] = await Promise.all([
        getOwnerConversations(),
        getUnreadCustomerMessages(),
      ]);
      const sorted = sortConversationsByRecency(nextConversations);
      setConversations(sorted);
      setUnreadCounts(countUnreadCustomerMessages(unread));
      setStatus("ready");

      try {
        const profileMap = await getCustomerProfiles(sorted.map((conversation) => conversation.customer_id));
        setProfiles(profileMap);
      } catch {
        // Names fall back to the stored conversation display name.
      }
    } catch (error) {
      setLoadError(getMessagesLoadErrorMessage(error));
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    void loadInbox();
  }, [loadInbox]);

  useEffect(() => {
    if (threadStatus !== "ready") return;
    threadEndRef.current?.scrollIntoView({ block: "end" });
  }, [threadStatus, messages.length]);

  const openConversation = useCallback(async (conversation) => {
    setSelectedId(conversation.id);
    setMobileChatOpen(true);
    setThreadStatus("loading");
    setThreadError("");
    setSendError("");
    setNotice("");
    try {
      const nextMessages = await getConversationMessages(conversation.id);
      setMessages(sortMessages(nextMessages));
      setThreadStatus("ready");

      try {
        const { markedRead } = await markMessagesRead({ conversationId: conversation.id });
        if (markedRead > 0) {
          setUnreadCounts((current) => {
            const next = new Map(current);
            next.delete(conversation.id);
            return next;
          });
          const stampedAt = new Date().toISOString();
          setMessages((current) => current.map((message) => (
            message.sender_role === "customer" && !message.read_at ? { ...message, read_at: stampedAt } : message
          )));
        }
      } catch {
        /* ignore read-receipt failures */
      }
    } catch (error) {
      setThreadError(getMessagesLoadErrorMessage(error));
      setThreadStatus("error");
    }
  }, []);

  const reloadThread = useCallback(async () => {
    if (!selectedId) return;
    setThreadStatus("loading");
    setThreadError("");
    try {
      const nextMessages = await getConversationMessages(selectedId);
      setMessages(sortMessages(nextMessages));
      setThreadStatus("ready");
    } catch (error) {
      setThreadError(getMessagesLoadErrorMessage(error));
      setThreadStatus("error");
    }
  }, [selectedId]);

  const handleReply = async (event) => {
    event.preventDefault();
    if (sending || !selectedId) return;
    const { value, error } = validateMessageDraft(draft);
    if (error) {
      setSendError(error);
      return;
    }

    setSending(true);
    setSendError("");
    setNotice("");
    try {
      await sendMessage({ conversationId: selectedId, body: value });
      setDraft("");
      setNotice("Reply sent to the customer.");
      const nextMessages = await getConversationMessages(selectedId);
      setMessages(sortMessages(nextMessages));
      const nextConversations = await getOwnerConversations();
      setConversations(sortConversationsByRecency(nextConversations));
    } catch (sendFailure) {
      setSendError(getSendMessageErrorMessage(sendFailure));
    } finally {
      setSending(false);
    }
  };

  const unreadTotal = useMemo(
    () => [...unreadCounts.values()].reduce((total, count) => total + count, 0),
    [unreadCounts],
  );

  const filteredConversations = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return conversations;
    return conversations.filter((conversation) => {
      const name = resolveCustomerName(conversation, profiles.get(conversation.customer_id)).toLowerCase();
      const preview = String(conversation.last_message_preview || "").toLowerCase();
      return name.includes(query) || preview.includes(query);
    });
  }, [conversations, profiles, search]);

  const selectedConversation = conversations.find((conversation) => conversation.id === selectedId) || null;
  const selectedName = selectedConversation
    ? resolveCustomerName(selectedConversation, profiles.get(selectedConversation.customer_id))
    : "";

  if (status === "loading") {
    return (
      <div className="messages-loading" role="status">
        <Loader2 className="messages-spinner" size={17} aria-hidden="true" />
        <span>Loading customer conversations…</span>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="messages-error-state" role="alert">
        <span className="messages-error-icon"><ShieldAlert size={19} aria-hidden="true" /></span>
        <div>
          <strong>We couldn’t load the inbox</strong>
          <p>{loadError}</p>
        </div>
        <button type="button" className="messages-retry-button" onClick={() => void loadInbox()}>
          <RefreshCw size={14} aria-hidden="true" /> Try again
        </button>
      </div>
    );
  }

  if (conversations.length === 0) {
    return (
      <div className="messages-empty-inbox">
        <span><MessageCircle size={20} aria-hidden="true" /></span>
        <strong>No customer conversations yet</strong>
        <p>Conversations appear here as soon as a signed-in customer sends the first message.</p>
        <button type="button" className="messages-retry-button" onClick={() => void loadInbox()}>
          <RefreshCw size={14} aria-hidden="true" /> Refresh
        </button>
      </div>
    );
  }

  return (
    <section className={`messages-layout admin-messages-layout${mobileChatOpen ? " messages-mobile-chat-open" : ""}`} aria-label="Customer conversations">
      <aside className="messages-inbox">
        <div className="messages-inbox-heading">
          <div>
            <h2>Conversations</h2>
            <span>{conversations.length} {conversations.length === 1 ? "customer" : "customers"}</span>
          </div>
          <div className="messages-inbox-heading-actions">
            {unreadTotal > 0 && <span className="messages-unread-total" aria-label={`${unreadTotal} unread customer messages`}>{unreadTotal}</span>}
            <button type="button" onClick={() => void loadInbox({ silent: true })} aria-label="Refresh conversations"><RefreshCw size={14} /></button>
          </div>
        </div>

        <label className="messages-search">
          <Search size={16} aria-hidden="true" />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search customers" aria-label="Search customers" />
          {search && <button type="button" onClick={() => setSearch("")} aria-label="Clear customer search"><X size={14} /></button>}
        </label>

        <div className="messages-conversation-list" role="list">
          {filteredConversations.map((conversation) => {
            const name = resolveCustomerName(conversation, profiles.get(conversation.customer_id));
            const unread = unreadCounts.get(conversation.id) || 0;
            return (
              <div role="listitem" key={conversation.id}>
                <button
                  type="button"
                  className={`messages-conversation${selectedId === conversation.id ? " selected" : ""}`}
                  aria-current={selectedId === conversation.id ? "true" : undefined}
                  onClick={() => void openConversation(conversation)}
                >
                  <Avatar name={name} />
                  <span className="messages-conversation-copy">
                    <span className="messages-conversation-topline">
                      <strong>{name}</strong>
                      <time>{conversation.last_message_at ? formatMessageTime(conversation.last_message_at) : "New"}</time>
                    </span>
                    <span className="messages-conversation-preview">{conversation.last_message_preview || "No messages yet"}</span>
                  </span>
                  {unread > 0 && <span className="messages-unread-total">{unread}</span>}
                </button>
              </div>
            );
          })}
          {filteredConversations.length === 0 && (
            <div className="messages-list-empty">
              <MessageCircle size={20} aria-hidden="true" />
              <strong>No matching customers</strong>
              <span>Try another search term.</span>
            </div>
          )}
        </div>
      </aside>

      <section className="messages-chat" aria-label="Selected conversation">
        {!selectedConversation ? (
          <div className="messages-chat-empty">
            <span><MessageCircle size={24} /></span>
            <h2>Select a conversation</h2>
            <p>Choose a customer to read their messages and reply. Opening a conversation marks their messages as read.</p>
          </div>
        ) : (
          <>
            <header className="messages-chat-header">
              <button type="button" className="messages-mobile-back" onClick={() => setMobileChatOpen(false)} aria-label="Back to conversations"><ArrowLeft size={17} /></button>
              <Avatar name={selectedName} />
              <div className="messages-chat-person">
                <strong>{selectedName}</strong>
                <span>Customer · {selectedConversation.customer_display_name || "NexTech account"}</span>
              </div>
              <div className="messages-header-actions">
                <button type="button" onClick={() => void reloadThread()} aria-label="Refresh conversation"><RefreshCw size={14} aria-hidden="true" /><span>Refresh</span></button>
              </div>
            </header>

            {threadStatus === "loading" && (
              <div className="messages-loading messages-loading-inline" role="status">
                <Loader2 className="messages-spinner" size={16} aria-hidden="true" />
                <span>Loading messages…</span>
              </div>
            )}

            {threadStatus === "error" && (
              <div className="messages-error-state messages-error-state-inline" role="alert">
                <span className="messages-error-icon"><ShieldAlert size={18} aria-hidden="true" /></span>
                <div><strong>We couldn’t load this conversation</strong><p>{threadError}</p></div>
                <button type="button" className="messages-retry-button" onClick={() => void reloadThread()}><RefreshCw size={14} aria-hidden="true" /> Try again</button>
              </div>
            )}

            {threadStatus === "ready" && (
              <>
                <div className="messages-thread" aria-live="polite" aria-label="Conversation messages">
                  {messages.length === 0 ? (
                    <div className="messages-thread-empty">
                      <MessageCircle size={20} aria-hidden="true" />
                      <p>No messages yet.</p>
                      <span>This conversation has no stored messages.</span>
                    </div>
                  ) : (
                    <>
                      {messages.map((message) => {
                        const ownMessage = message.sender_role === "owner";
                        return (
                          <article className={`messages-bubble-row${ownMessage ? " own" : ""}`} key={message.id}>
                            {!ownMessage && <Avatar name={selectedName} className="messages-avatar-small" />}
                            <div className="messages-bubble-wrap">
                              <span className="messages-bubble-author">{ownMessage ? "You (owner)" : selectedName}</span>
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

                <form className="messages-composer" onSubmit={handleReply}>
                  {sendError && <p className="messages-error" role="alert">{sendError}</p>}
                  {notice && <p className="messages-action-notice" role="status">{notice}</p>}
                  <label className="messages-compose-input">
                    <span className="visually-hidden">Reply to the customer</span>
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
                      placeholder={`Reply to ${selectedName}…`}
                      disabled={sending}
                    />
                    <span>{Array.from(draft).length}/{maximumMessageLength}</span>
                  </label>
                  <div className="messages-compose-actions">
                    <span className="messages-attachment-help"><AlertCircle size={13} aria-hidden="true" /> Attachments are not available yet.</span>
                    <button className="market-button market-button-primary messages-send-button" type="submit" disabled={sending} aria-busy={sending}>
                      {sending ? "Sending…" : "Send reply"} <Send size={14} aria-hidden="true" />
                    </button>
                  </div>
                </form>
              </>
            )}
          </>
        )}
      </section>
    </section>
  );
}
