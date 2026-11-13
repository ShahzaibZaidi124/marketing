import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Ban,
  Check,
  ChevronDown,
  FileText,
  Flag,
  ImagePlus,
  MessageCircle,
  Paperclip,
  Search,
  Send,
  ShieldAlert,
  UserRound,
  X,
} from "lucide-react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { useMarketplace } from "../context/MarketplaceContext.jsx";

const maxAttachmentSize = 10 * 1024 * 1024;
const allowedExtensions = [".jpg", ".jpeg", ".png", ".webp", ".pdf", ".doc", ".docx"];
const allowedMimeTypes = {
  ".jpg": ["image/jpeg"],
  ".jpeg": ["image/jpeg"],
  ".png": ["image/png"],
  ".webp": ["image/webp"],
  ".pdf": ["application/pdf"],
  ".doc": ["application/msword"],
  ".docx": ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
};

function makeMessage(senderRole, text, minutesAgo, sampleStatus = "") {
  return {
    id: `sample-${senderRole}-${minutesAgo}`,
    senderRole,
    text,
    createdAt: new Date(Date.now() - minutesAgo * 60 * 1000).toISOString(),
    sample: true,
    sampleStatus,
  };
}

function makeSampleConversations() {
  return [
    {
      id: "sample-order-1",
      customerName: "Ava Brooks",
      sellerName: "Northstar Studio",
      customerInitials: "AB",
      sellerInitials: "NS",
      serviceTitle: "Custom business website design & development",
      order: { number: "TS-DEMO-2418", status: "Requirements review" },
      unread: 2,
      messages: [
        makeMessage("seller", "Thanks for sharing your project brief. I can help organize the pages and content before development.", 84),
        makeMessage("customer", "That sounds good. I will gather the brand colors and page copy for the next update.", 42, "read"),
      ],
    },
    {
      id: "sample-order-2",
      customerName: "Noah James",
      sellerName: "Pixel & Co.",
      customerInitials: "NJ",
      sellerInitials: "PC",
      serviceTitle: "E-commerce store built around your brand",
      order: { number: "TS-DEMO-1932", status: "In progress" },
      unread: 1,
      messages: [
        makeMessage("customer", "Could you include a section for featured products on the home page?", 165),
        makeMessage("seller", "Yes, that can be included in this sample project scope.", 123, "delivered"),
      ],
    },
    {
      id: "sample-order-3",
      customerName: "Mia Carter",
      sellerName: "Brightline Web",
      customerInitials: "MC",
      sellerInitials: "BW",
      serviceTitle: "Conversion-focused landing page for your next launch",
      order: { number: "TS-DEMO-1784", status: "Completed" },
      unread: 0,
      messages: [
        makeMessage("seller", "The sample landing page outline is ready for review.", 1440),
        makeMessage("customer", "I have reviewed it. Thank you for the clear handoff notes.", 1320, "read"),
      ],
    },
  ];
}

function initials(name = "") {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0] || "").join("").toUpperCase();
}

function formatTime(value) {
  return new Date(value).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function formatFileSize(size) {
  return size < 1024 * 1024
    ? `${Math.max(1, Math.round(size / 1024))} KB`
    : `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function Avatar({ name, className = "" }) {
  return (
    <span className={`messages-avatar ${className}`} aria-hidden="true">
      {initials(name) || <UserRound size={17} />}
    </span>
  );
}

function AttachmentPreview({ attachment }) {
  return (
    <a className="messages-attachment" href={attachment.url} download={attachment.name}>
      {attachment.isImage
        ? <img src={attachment.url} alt={attachment.name} />
        : <span className="messages-attachment-icon"><FileText size={17} /></span>}
      <span className="messages-attachment-copy">
        <strong>{attachment.name}</strong>
        <small>{formatFileSize(attachment.size)} · Download local preview</small>
      </span>
      <ChevronDown size={14} className="messages-download-icon" aria-hidden="true" />
    </a>
  );
}

export default function Messages() {
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const { allServices } = useMarketplace();
  const sellerProfile = location.state?.sellerProfile;
  const serviceId = searchParams.get("service");
  const requestedRole = searchParams.get("role");
  const [role, setRole] = useState(requestedRole === "seller" ? "seller" : "customer");
  const [conversations, setConversations] = useState(makeSampleConversations);
  const [selectedId, setSelectedId] = useState(null);
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState("");
  const [pendingAttachment, setPendingAttachment] = useState(null);
  const [attachmentError, setAttachmentError] = useState("");
  const [composeError, setComposeError] = useState("");
  const [actionNotice, setActionNotice] = useState("");
  const [blockedIds, setBlockedIds] = useState(() => new Set());
  const [mobileChatOpen, setMobileChatOpen] = useState(false);
  const [serviceError, setServiceError] = useState("");
  const messageEndRef = useRef(null);
  const attachmentUrlsRef = useRef(new Set());

  const selectedService = serviceId ? allServices.find((service) => service.id === serviceId) : null;

  useEffect(() => {
    if (requestedRole === "customer" || requestedRole === "seller") setRole(requestedRole);
  }, [requestedRole]);

  useEffect(() => {
    if (!serviceId) {
      setServiceError("");
      return;
    }
    if (!selectedService) {
      setServiceError("That service is unavailable in this browser session. Browse services to start a new demo.");
      return;
    }

    const id = `service-${selectedService.id}`;
    setConversations((current) => current.some((conversation) => conversation.id === id)
      ? current
      : [{
          id,
          customerName: "Demo customer",
          sellerName: selectedService.seller,
          customerInitials: "DC",
          sellerInitials: selectedService.sellerInitials || initials(selectedService.seller),
          serviceTitle: selectedService.title,
          serviceId: selectedService.id,
          order: null,
          unread: 0,
          messages: [],
        }, ...current]);
    setSelectedId(id);
    setMobileChatOpen(true);
    setSearchParams({ service: selectedService.id, role: "customer" }, { replace: true });
    setServiceError("");
  }, [serviceId, selectedService, setSearchParams]);

  useEffect(() => () => {
    attachmentUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
  }, []);

  const selectedConversation = conversations.find((conversation) => conversation.id === selectedId);
  const selectedMessageCount = selectedConversation?.messages.length || 0;
  const counterpartName = selectedConversation
    ? role === "customer" ? selectedConversation.sellerName : selectedConversation.customerName
    : "";
  const unreadCount = conversations.reduce((total, conversation) => total + conversation.unread, 0);

  const filteredConversations = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    return conversations.filter((conversation) => {
      const otherName = role === "customer" ? conversation.sellerName : conversation.customerName;
      const lastMessage = conversation.messages[conversation.messages.length - 1];
      const matchesFilter = filter === "all"
        || (filter === "unread" && conversation.unread > 0)
        || (filter === "customers" && role === "seller")
        || (filter === "sellers" && role === "customer");
      const searchable = `${otherName} ${conversation.serviceTitle} ${lastMessage?.text || ""}`.toLowerCase();
      return matchesFilter && (!normalizedSearch || searchable.includes(normalizedSearch));
    });
  }, [conversations, filter, role, search]);

  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [selectedId, selectedMessageCount]);

  const selectConversation = (conversation) => {
    setSelectedId(conversation.id);
    setConversations((current) => current.map((item) => item.id === conversation.id ? { ...item, unread: 0 } : item));
    setMobileChatOpen(true);
    setActionNotice("");
    setComposeError("");
  };

  const changeRole = (event) => {
    const nextRole = event.target.value;
    setRole(nextRole);
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set("role", nextRole);
    setSearchParams(nextParams, { replace: true, state: location.state });
  };

  const handleAttachment = (event) => {
    const file = event.target.files?.[0];
    setAttachmentError("");
    setComposeError("");
    if (!file) return;

    const extension = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
    if (!allowedExtensions.includes(extension) || (file.type && !allowedMimeTypes[extension]?.includes(file.type))) {
      setAttachmentError("Choose an image, PDF, DOC or DOCX file.");
      event.target.value = "";
      return;
    }
    if (file.size > maxAttachmentSize) {
      setAttachmentError("Attachments must be 10 MB or smaller.");
      event.target.value = "";
      return;
    }

    if (pendingAttachment) {
      URL.revokeObjectURL(pendingAttachment.url);
      attachmentUrlsRef.current.delete(pendingAttachment.url);
    }
    const url = URL.createObjectURL(file);
    attachmentUrlsRef.current.add(url);
    setPendingAttachment({
      name: file.name,
      size: file.size,
      url,
      isImage: file.type.startsWith("image/"),
    });
    event.target.value = "";
  };

  const removePendingAttachment = () => {
    if (pendingAttachment) {
      URL.revokeObjectURL(pendingAttachment.url);
      attachmentUrlsRef.current.delete(pendingAttachment.url);
    }
    setPendingAttachment(null);
    setAttachmentError("");
  };

  const sendMessage = (event) => {
    event.preventDefault();
    const text = draft.trim();
    if (!selectedConversation) {
      setComposeError("Choose a conversation to write a message preview.");
      return;
    }
    if (blockedIds.has(selectedConversation.id)) {
      setComposeError("Unblock this sample conversation before writing a preview.");
      return;
    }
    if (!text && !pendingAttachment) {
      setComposeError("Write a message or attach a file first.");
      return;
    }

    const message = {
      id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      senderRole: role,
      text,
      createdAt: new Date().toISOString(),
      localPreview: true,
      attachment: pendingAttachment,
    };
    setConversations((current) => current.map((conversation) => conversation.id === selectedConversation.id
      ? { ...conversation, unread: 0, messages: [...conversation.messages, message] }
      : conversation));
    setDraft("");
    setPendingAttachment(null);
    setComposeError("");
    setAttachmentError("");
    setActionNotice("Local preview only — this message and any attachment were not sent or saved.");
  };

  const reportConversation = () => {
    setActionNotice("Report preview noted in this page only. No report was sent.");
  };

  const toggleBlock = () => {
    if (!selectedConversation) return;
    const isBlocked = blockedIds.has(selectedConversation.id);
    setBlockedIds((current) => {
      const next = new Set(current);
      if (isBlocked) next.delete(selectedConversation.id);
      else next.add(selectedConversation.id);
      return next;
    });
    setActionNotice(isBlocked
      ? "This sample conversation is unblocked in the current page."
      : "This sample conversation is blocked in the current page only. No real user was blocked.");
  };

  const filters = [
    { id: "all", label: "All" },
    { id: "unread", label: "Unread" },
    { id: "customers", label: "Customers" },
    { id: "sellers", label: "Sellers" },
  ];

  return (
    <main className="messages-page">
      <header className="messages-heading">
        <div>
          <span className="market-eyebrow">TECHSTUDIO MESSAGES</span>
          <h1>Inbox</h1>
          <p>Discuss project details in one place.</p>
        </div>
        <label className="messages-role-picker">
          <span>Previewing as</span>
          <select value={role} onChange={changeRole} aria-label="Preview messaging as">
            <option value="customer">Customer</option>
            <option value="seller">Seller</option>
          </select>
        </label>
      </header>

      <aside className="messages-demo-note" role="note">
        <ShieldAlert size={18} />
        <p><strong>Demo messaging only.</strong> There is no authentication or messaging backend. These conversations are samples; messages and attachments stay in this page, are not private from other local users, and are not delivered, stored, or synced.</p>
      </aside>
      {serviceError && <p className="messages-error" role="alert">{serviceError}</p>}

      <section className={`messages-layout${mobileChatOpen ? " messages-mobile-chat-open" : ""}`} aria-label="Messaging inbox">
        <aside className="messages-inbox">
          <div className="messages-inbox-heading">
            <div><h2>Conversations</h2><span>{conversations.length} sample threads</span></div>
            {unreadCount > 0 && <span className="messages-unread-total" aria-label={`${unreadCount} unread sample messages`}>{unreadCount}</span>}
          </div>

          <label className="messages-search">
            <Search size={16} aria-hidden="true" />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search conversations" aria-label="Search conversations" />
            {search && <button type="button" onClick={() => setSearch("")} aria-label="Clear conversation search"><X size={14} /></button>}
          </label>

          <div className="messages-filters" role="group" aria-label="Filter conversations">
            {filters.map((item) => (
              <button
                type="button"
                key={item.id}
                className={filter === item.id ? "active" : ""}
                aria-pressed={filter === item.id}
                onClick={() => setFilter(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>

          <div className="messages-conversation-list" role="list">
            {filteredConversations.map((conversation) => {
              const otherName = role === "customer" ? conversation.sellerName : conversation.customerName;
              const otherInitials = role === "customer" ? conversation.sellerInitials : conversation.customerInitials;
              const lastMessage = conversation.messages[conversation.messages.length - 1];
              return (
                <div role="listitem" key={conversation.id}>
                  <button
                    type="button"
                    className={`messages-conversation${selectedId === conversation.id ? " selected" : ""}`}
                    aria-current={selectedId === conversation.id ? "true" : undefined}
                    onClick={() => selectConversation(conversation)}
                  >
                    <Avatar name={otherInitials || otherName} />
                    <span className="messages-conversation-copy">
                      <span className="messages-conversation-topline"><strong>{otherName}</strong><time>{lastMessage ? formatTime(lastMessage.createdAt) : "New"}</time></span>
                      <span className="messages-conversation-service">{conversation.serviceTitle}</span>
                      <span className="messages-conversation-preview">{lastMessage?.text || "Start a local message preview"}</span>
                    </span>
                    {conversation.unread > 0 && <span className="messages-unread-dot" aria-label={`${conversation.unread} unread`} />}
                    {blockedIds.has(conversation.id) && <span className="messages-blocked-label">Blocked</span>}
                  </button>
                </div>
              );
            })}
            {filteredConversations.length === 0 && (
              <div className="messages-list-empty">
                <MessageCircle size={20} />
                <strong>No conversations found</strong>
                <span>Try another search or filter.</span>
              </div>
            )}
          </div>
          <p className="messages-inbox-footnote">Sample data only · no live notifications</p>
        </aside>

        <section className="messages-chat" aria-label="Selected conversation">
          {!selectedConversation ? (
            <div className="messages-chat-empty">
              <span><MessageCircle size={24} /></span>
              <h2>Select a conversation</h2>
              <p>Choose a sample thread to view its messages. No real messages are available in demo mode.</p>
            </div>
          ) : (
            <>
              <header className="messages-chat-header">
                <button type="button" className="messages-mobile-back" onClick={() => setMobileChatOpen(false)} aria-label="Back to conversations"><ArrowLeft size={17} /></button>
                <Avatar name={counterpartName} />
                <div className="messages-chat-person">
                  <strong>{counterpartName}</strong>
                  <span>{role === "customer" ? "Seller" : "Customer"} · Sample profile</span>
                </div>
                <div className="messages-header-actions">
                  <button type="button" onClick={reportConversation} aria-label="Report sample user"><Flag size={15} /><span>Report</span></button>
                  <button type="button" onClick={toggleBlock} aria-label={blockedIds.has(selectedConversation.id) ? "Unblock sample user" : "Block sample user"}>
                    {blockedIds.has(selectedConversation.id) ? <Check size={15} /> : <Ban size={15} />}
                    <span>{blockedIds.has(selectedConversation.id) ? "Unblock" : "Block"}</span>
                  </button>
                </div>
              </header>

              {selectedConversation.order ? (
                <div className="messages-order-reference">
                  <span className="messages-order-icon"><FileText size={16} /></span>
                  <span><small>Sample order · {selectedConversation.order.number}</small><strong>{selectedConversation.serviceTitle}</strong></span>
                  <span className="messages-order-status">{selectedConversation.order.status}</span>
                </div>
              ) : (
                <div className="messages-order-reference messages-no-order">
                  <span className="messages-order-icon"><FileText size={16} /></span>
                  <span><small>Service inquiry preview</small><strong>{selectedConversation.serviceTitle}</strong></span>
                  {selectedConversation.serviceId && <Link to={`/services/${selectedConversation.serviceId}`}>View service</Link>}
                </div>
              )}

              <div className="messages-thread" aria-live="polite" aria-label="Conversation messages">
                {selectedConversation.messages.length === 0 ? (
                  <div className="messages-thread-empty">
                    <MessageCircle size={19} />
                    <p>Start a message preview about this service.</p>
                    <span>It will remain local and will not reach the seller.</span>
                  </div>
                ) : (
                  <>
                    <div className="messages-sample-divider"><span>Sample conversation · not a real order</span></div>
                    {selectedConversation.messages.map((message) => {
                      const ownMessage = message.senderRole === role;
                      return (
                        <article className={`messages-bubble-row${ownMessage ? " own" : ""}`} key={message.id}>
                          {!ownMessage && <Avatar name={counterpartName} className="messages-avatar-small" />}
                          <div className="messages-bubble-wrap">
                            <span className="messages-bubble-author">{ownMessage ? "You" : counterpartName}</span>
                            <div className="messages-bubble">
                              {message.text && <p>{message.text}</p>}
                              {message.attachment && <AttachmentPreview attachment={message.attachment} />}
                            </div>
                            <span className="messages-bubble-meta">
                              <time>{formatTime(message.createdAt)}</time>
                              {message.localPreview
                                ? <span className="messages-local-status">Local preview · not sent</span>
                                : message.sample && ownMessage && message.sampleStatus
                                  ? <span className="messages-sample-status">{message.sampleStatus} · sample</span>
                                  : message.sample && <span className="messages-sample-status">Sample</span>}
                            </span>
                          </div>
                        </article>
                      );
                    })}
                    <div ref={messageEndRef} />
                  </>
                )}
              </div>

              {actionNotice && <p className="messages-action-notice" role="status">{actionNotice}</p>}

              <form className="messages-composer" onSubmit={sendMessage}>
                {pendingAttachment && (
                  <div className="messages-pending-attachment">
                    {pendingAttachment.isImage
                      ? <img src={pendingAttachment.url} alt="" />
                      : <FileText size={18} />}
                    <span>{pendingAttachment.name} · {formatFileSize(pendingAttachment.size)}</span>
                    <button type="button" onClick={removePendingAttachment} aria-label="Remove attachment"><X size={14} /></button>
                  </div>
                )}
                {attachmentError && <p className="messages-error" role="alert">{attachmentError}</p>}
                {composeError && <p className="messages-error" role="alert">{composeError}</p>}
                <label className="messages-compose-input">
                  <span className="visually-hidden">Write a message</span>
                  <textarea
                    value={draft}
                    onChange={(event) => { setDraft(event.target.value); setComposeError(""); }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        event.currentTarget.form?.requestSubmit();
                      }
                    }}
                    maxLength={2000}
                    rows={2}
                    placeholder={blockedIds.has(selectedConversation.id) ? "Unblock this sample conversation to continue" : "Write a message preview…"}
                    disabled={blockedIds.has(selectedConversation.id)}
                  />
                  <span>{draft.length}/2000</span>
                </label>
                <div className="messages-compose-actions">
                  <label className={`messages-attach-button${blockedIds.has(selectedConversation.id) ? " disabled" : ""}`}>
                    <Paperclip size={15} /><span>Attach file</span>
                    <input type="file" accept=".jpg,.jpeg,.png,.webp,.pdf,.doc,.docx,image/jpeg,image/png,image/webp,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={handleAttachment} disabled={blockedIds.has(selectedConversation.id)} />
                  </label>
                  <span className="messages-attachment-help"><ImagePlus size={13} /> Images or documents · 10 MB max · local only</span>
                  <button className="market-button market-button-primary messages-send-button" type="submit" disabled={blockedIds.has(selectedConversation.id)}>
                    Preview message <Send size={14} />
                  </button>
                </div>
              </form>
            </>
          )}
        </section>
      </section>
      <div className="messages-page-footer">
        <Link
          to={role === "seller" ? sellerProfile ? "/seller/dashboard" : "/seller" : "/services"}
          state={role === "seller" && sellerProfile ? { sellerProfile } : undefined}
        >
          <ArrowLeft size={14} /> {role === "seller" ? sellerProfile ? "Back to seller dashboard" : "Back to seller introduction" : "Back to services"}
        </Link>
      </div>
    </main>
  );
}
