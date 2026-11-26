import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  Bot,
  Send,
  Database,
  Plus,
  History,
  Trash2,
  AlertCircle,
  ShieldAlert,
  RefreshCw,
  Upload,
  Sparkles,
  Loader2,
  Clock,
  FileCheck2,
  MessageSquare,
} from 'lucide-react';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import { LoadingSpinner } from '../../components/ui/LoadingState';
import { StatusBadge, VisibilityBadge } from '../../components/ui/Badge';
import AssistantMessage from '../../components/assistant/AssistantMessage';
import CitationDetailModal from '../../components/assistant/CitationDetailModal';
import { getKnowledgeBases } from '../../services/kbService';
import { getDocuments } from '../../services/docService';
import {
  queryRag,
  getConversations,
  getConversation,
  deleteConversation,
} from '../../services/ragService';
import { formatDateTime } from '../../utils/formatters';

const SUGGESTED_PROMPTS = [
  'Summarize the key policies and requirements in this knowledge base.',
  'What compliance or security obligations are mentioned in the documents?',
  'List the main action items or procedures covered here.',
];

export default function AiAssistant() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  // Knowledge Bases & Documents Readiness
  const [kbs, setKbs] = useState([]);
  const [kbsLoading, setKbsLoading] = useState(true);
  const [kbsError, setKbsError] = useState(null);
  const [selectedKbId, setSelectedKbId] = useState(searchParams.get('kbId') || '');

  const [kbDocs, setKbDocs] = useState([]);
  const [docsLoading, setDocsLoading] = useState(false);
  const [docsError, setDocsError] = useState(null);

  // Conversation History
  const [conversations, setConversations] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState(null);
  const [activeConversationId, setActiveConversationId] = useState(
    searchParams.get('conversationId') || null
  );
  const [loadingConversation, setLoadingConversation] = useState(false);

  // Active Chat Session
  const [messages, setMessages] = useState([]);
  const [question, setQuestion] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const [lastSubmittedQuestion, setLastSubmittedQuestion] = useState('');

  // Clickable Source Modal
  const [selectedCitation, setSelectedCitation] = useState(null);

  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const initialKbParamRef = useRef(searchParams.get('kbId'));
  const initialConvParamRef = useRef(searchParams.get('conversationId'));

  // 1. Load accessible Knowledge Bases & Conversation History on mount
  const reloadInitialWorkspace = async () => {
    setKbsLoading(true);
    setKbsError(null);
    setHistoryLoading(true);
    setHistoryError(null);

    try {
      const kbRes = await getKnowledgeBases();
      const loadedKbs = kbRes.data || [];
      setKbs(loadedKbs);

      const urlKbId = searchParams.get('kbId');
      if (urlKbId && loadedKbs.some((kb) => kb._id === urlKbId)) {
        setSelectedKbId(urlKbId);
      } else if (loadedKbs.length > 0) {
        const firstActive = loadedKbs.find((kb) => kb.status !== 'archived') || loadedKbs[0];
        setSelectedKbId((prev) =>
          prev && loadedKbs.some((k) => k._id === prev) ? prev : firstActive._id
        );
      } else {
        setSelectedKbId('');
      }
    } catch (err) {
      setKbsError(err.response?.data?.message || 'Failed to load accessible knowledge bases.');
    } finally {
      setKbsLoading(false);
    }

    try {
      const convRes = await getConversations();
      setConversations(convRes.data || []);
    } catch (err) {
      setHistoryError(err.response?.data?.message || 'Unable to load conversation history.');
    } finally {
      setHistoryLoading(false);
    }
  };

  useEffect(() => {
    let active = true;
    const init = async () => {
      try {
        const kbRes = await getKnowledgeBases();
        if (!active) return;
        const loadedKbs = kbRes.data || [];
        setKbs(loadedKbs);

        const urlKbId = initialKbParamRef.current;
        if (urlKbId && loadedKbs.some((kb) => kb._id === urlKbId)) {
          setSelectedKbId(urlKbId);
        } else if (loadedKbs.length > 0) {
          const firstActive = loadedKbs.find((kb) => kb.status !== 'archived') || loadedKbs[0];
          setSelectedKbId(firstActive._id);
        }
      } catch (err) {
        if (active) {
          setKbsError(err.response?.data?.message || 'Failed to load accessible knowledge bases.');
        }
      } finally {
        if (active) setKbsLoading(false);
      }

      try {
        const convRes = await getConversations();
        if (active) {
          setConversations(convRes.data || []);
        }
      } catch (err) {
        if (active) {
          setHistoryError(err.response?.data?.message || 'Unable to load conversation history.');
        }
      } finally {
        if (active) setHistoryLoading(false);
      }
    };

    init();
    return () => {
      active = false;
    };
  }, []);

  // Load initial conversation if specified in query string
  useEffect(() => {
    const urlConvId = initialConvParamRef.current;
    if (!urlConvId) return;

    let active = true;
    const loadInitialConversation = async () => {
      try {
        setLoadingConversation(true);
        const res = await getConversation(urlConvId);
        if (!active) return;
        const conv = res.data;
        if (conv) {
          setActiveConversationId(conv._id);
          if (conv.knowledgeBase) {
            setSelectedKbId(conv.knowledgeBase);
          }
          setMessages(conv.messages || []);
        }
      } catch (err) {
        if (active) {
          setSubmitError({
            status: err.response?.status,
            message: err.response?.data?.message || 'Unable to load conversation.',
          });
        }
      } finally {
        if (active) setLoadingConversation(false);
      }
    };

    loadInitialConversation();
    return () => {
      active = false;
    };
  }, []);

  // 2. Load documents for selected Knowledge Base to inspect indexing readiness
  const refreshSelectedKbDocs = async (kbIdToLoad = selectedKbId) => {
    if (!kbIdToLoad) return;
    setDocsLoading(true);
    setDocsError(null);
    try {
      const res = await getDocuments(kbIdToLoad);
      setKbDocs(res.data || []);
    } catch (err) {
      setDocsError(err.response?.data?.message || 'Unable to inspect knowledge base documents.');
      setKbDocs([]);
    } finally {
      setDocsLoading(false);
    }
  };

  useEffect(() => {
    if (!selectedKbId) return;

    let active = true;
    const loadDocs = async () => {
      try {
        setDocsLoading(true);
        setDocsError(null);
        const res = await getDocuments(selectedKbId);
        if (active) {
          setKbDocs(res.data || []);
        }
      } catch (err) {
        if (active) {
          setDocsError(err.response?.data?.message || 'Unable to inspect knowledge base documents.');
          setKbDocs([]);
        }
      } finally {
        if (active) setDocsLoading(false);
      }
    };

    loadDocs();
    return () => {
      active = false;
    };
  }, [selectedKbId]);

  useEffect(() => {
    if (typeof messagesEndRef.current?.scrollIntoView === 'function') {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, submitting]);

  const selectedKb = useMemo(
    () => kbs.find((kb) => kb._id === selectedKbId) || null,
    [kbs, selectedKbId]
  );

  const docStats = useMemo(() => {
    const activeDocs = selectedKbId ? kbDocs : [];
    const total = activeDocs.length;
    const indexed = activeDocs.filter((d) => d.indexingStatus === 'indexed').length;
    const processing = activeDocs.filter(
      (d) => d.indexingStatus === 'processing' || d.indexingStatus === 'pending'
    ).length;
    const failed = activeDocs.filter((d) => d.indexingStatus === 'failed').length;
    return { total, indexed, processing, failed };
  }, [kbDocs, selectedKbId]);

  const handleSelectKb = (nextKbId) => {
    setSelectedKbId(nextKbId);
    setKbDocs([]);
    setActiveConversationId(null);
    setMessages([]);
    setSubmitError(null);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (nextKbId) next.set('kbId', nextKbId);
      else next.delete('kbId');
      next.delete('conversationId');
      return next;
    });
  };

  const handleStartNewChat = () => {
    setActiveConversationId(null);
    setMessages([]);
    setSubmitError(null);
    setQuestion('');
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('conversationId');
      return next;
    });
    inputRef.current?.focus();
  };

  const handleSelectConversation = async (convId) => {
    if (!convId) return;
    setLoadingConversation(true);
    setSubmitError(null);
    try {
      const res = await getConversation(convId);
      const conv = res.data;
      if (conv) {
        setActiveConversationId(conv._id);
        if (conv.knowledgeBase) {
          setSelectedKbId(conv.knowledgeBase);
        }
        setMessages(conv.messages || []);
        setSearchParams({
          ...(conv.knowledgeBase ? { kbId: conv.knowledgeBase } : {}),
          conversationId: conv._id,
        });
      }
    } catch (err) {
      setSubmitError({
        status: err.response?.status,
        message: err.response?.data?.message || 'Unable to load selected conversation.',
      });
    } finally {
      setLoadingConversation(false);
    }
  };

  const handleDeleteConversation = async (e, convId) => {
    e.stopPropagation();
    try {
      await deleteConversation(convId);
      setConversations((prev) => prev.filter((c) => c._id !== convId));
      if (activeConversationId === convId) {
        handleStartNewChat();
      }
    } catch (err) {
      setHistoryError(err.response?.data?.message || 'Failed to delete conversation.');
    }
  };

  const submitQuestionText = async (rawText) => {
    const cleanQuestion = rawText.trim();
    if (!cleanQuestion || !selectedKbId || submitting) return;
    if (selectedKb?.status === 'archived') return;

    setSubmitError(null);
    setLastSubmittedQuestion(cleanQuestion);

    const optimisticUserMsg = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: cleanQuestion,
      citations: [],
    };
    setMessages((prev) => [...prev, optimisticUserMsg]);
    setQuestion('');
    setSubmitting(true);

    try {
      const res = await queryRag({
        question: cleanQuestion,
        knowledgeBaseId: selectedKbId,
        conversationId: activeConversationId,
      });

      const ragData = res.data || res;
      const nextConvId = ragData.conversationId || activeConversationId;

      if (nextConvId && nextConvId !== activeConversationId) {
        setActiveConversationId(nextConvId);
        setSearchParams({
          kbId: selectedKbId,
          conversationId: nextConvId,
        });
      }

      const assistantMsg = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: ragData.answer,
        citations: ragData.citations || [],
        metadata: ragData.metadata || null,
        insufficientEvidence: Boolean(ragData.metadata?.insufficient_evidence),
      };

      setMessages((prev) => [...prev, assistantMsg]);

      // Refresh conversation list quietly so newly created/updated conversation appears
      getConversations()
        .then((convRes) => setConversations(convRes.data || []))
        .catch(() => {});
    } catch (err) {
      const status = err.response?.status;
      const errMsg =
        status === 403
          ? err.response?.data?.message ||
            'Access denied: you do not have permission to query this knowledge base.'
          : err.response?.data?.message ||
            err.message ||
            'Failed to generate an answer. Please try again.';

      setSubmitError({ status, message: errMsg });
      // Restore question into input if failed so user does not lose their query
      setQuestion(cleanQuestion);
      setMessages((prev) => prev.filter((m) => m.id !== optimisticUserMsg.id));
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    await submitQuestionText(question);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (question.trim() && !submitting && selectedKb?.status !== 'archived') {
        submitQuestionText(question);
      }
    }
  };

  if (kbsLoading) {
    return <LoadingSpinner message="Loading AI Assistant workspace..." />;
  }

  if (kbsError) {
    return (
      <div className="max-w-lg mx-auto py-16">
        <div className="bg-red-50 border border-red-200 rounded-xl p-8 text-center">
          <AlertCircle size={40} className="text-red-500 mx-auto mb-3" />
          <h2 className="text-lg font-semibold text-red-900 mb-1">
            Unable to load AI Assistant
          </h2>
          <p className="text-xs text-red-600 mb-4">{kbsError}</p>
          <Button variant="outline" size="sm" onClick={reloadInitialWorkspace} className="gap-2">
            <RefreshCw size={14} /> Try Again
          </Button>
        </div>
      </div>
    );
  }

  if (kbs.length === 0) {
    return (
      <div className="max-w-4xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight flex items-center gap-2.5">
            <Bot size={28} className="text-primary-600" />
            <span>AI Assistant</span>
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Ask questions across your enterprise knowledge bases with verified citations.
          </p>
        </div>

        <EmptyState
          icon={Database}
          title="No Knowledge Bases available"
          description="Create a knowledge base and upload documents before querying the AI Assistant."
          actionLabel="Create Knowledge Base"
          onAction={() => navigate('/knowledge-bases/create')}
        />
      </div>
    );
  }

  const isArchivedKb = selectedKb?.status === 'archived';
  const showUnindexedNotice =
    !docsLoading && !docsError && selectedKb && (docStats.total === 0 || docStats.indexed === 0);

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Page Header & Knowledge Base Selector */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight flex items-center gap-2.5">
            <Bot size={28} className="text-primary-600" />
            <span>AI Assistant</span>
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Grounded answers strictly retrieved from your authorized knowledge base documents.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Knowledge Base Selector */}
          <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-lg px-3 py-2 shadow-sm">
            <Database size={16} className="text-primary-600 shrink-0" />
            <label htmlFor="kb-selector" className="sr-only">
              Select Knowledge Base
            </label>
            <select
              id="kb-selector"
              aria-label="Select Knowledge Base"
              value={selectedKbId}
              onChange={(e) => handleSelectKb(e.target.value)}
              className="bg-transparent text-sm font-medium text-slate-800 focus:outline-none cursor-pointer max-w-[240px]"
            >
              {kbs.map((kb) => (
                <option key={kb._id} value={kb._id}>
                  {kb.name} {kb.status === 'archived' ? '(Archived)' : ''}
                </option>
              ))}
            </select>
          </div>

          {/* Indexed Documents Pill */}
          {selectedKb && !docsLoading && (
            <span
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border ${
                docStats.indexed > 0
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200/70'
                  : 'bg-amber-50 text-amber-700 border-amber-200/70'
              }`}
            >
              <FileCheck2 size={14} />
              <span>
                {docStats.indexed > 0
                  ? `${docStats.indexed} indexed ${docStats.indexed === 1 ? 'doc' : 'docs'}`
                  : '0 indexed docs'}
              </span>
            </span>
          )}

          <Button
            variant="outline"
            size="sm"
            onClick={handleStartNewChat}
            className="gap-1.5 bg-white"
          >
            <Plus size={15} />
            <span>New Chat</span>
          </Button>
        </div>
      </div>

      {/* Main Split Workspace */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: Conversation History */}
        <Card className="lg:col-span-3 border-slate-200 bg-white overflow-hidden">
          <div className="px-4 py-3.5 border-b border-slate-100 flex items-center justify-between bg-slate-50/60">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
              <History size={16} className="text-primary-600" />
              <span>Conversation History</span>
            </div>
            <button
              type="button"
              onClick={handleStartNewChat}
              title="Start new conversation"
              aria-label="Start new conversation"
              className="p-1 text-slate-400 hover:text-primary-600 rounded hover:bg-slate-100 transition-colors"
            >
              <Plus size={16} />
            </button>
          </div>

          <div className="max-h-[460px] overflow-y-auto divide-y divide-slate-100">
            {historyLoading ? (
              <div className="p-6 text-center text-xs text-slate-400 flex flex-col items-center gap-2">
                <Loader2 size={18} className="animate-spin text-primary-500" />
                <span>Loading history...</span>
              </div>
            ) : historyError ? (
              <div className="p-4 text-xs text-amber-700 bg-amber-50/60">
                {historyError}
              </div>
            ) : conversations.length === 0 ? (
              <div className="p-6 text-center space-y-1.5">
                <MessageSquare size={22} className="mx-auto text-slate-300" />
                <p className="text-xs font-medium text-slate-600">No conversations yet</p>
                <p className="text-[11px] text-slate-400">
                  Your saved Q&amp;A sessions will appear here.
                </p>
              </div>
            ) : (
              conversations.map((conv) => {
                const isActive = activeConversationId === conv._id;
                return (
                  <div
                    key={conv._id}
                    onClick={() => handleSelectConversation(conv._id)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        handleSelectConversation(conv._id);
                      }
                    }}
                    className={`w-full text-left px-4 py-3 cursor-pointer transition-colors group flex items-start justify-between gap-2 ${
                      isActive
                        ? 'bg-primary-50/70 border-l-2 border-primary-600'
                        : 'hover:bg-slate-50'
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <p
                        className={`text-xs font-medium truncate ${
                          isActive ? 'text-primary-700' : 'text-slate-800'
                        }`}
                      >
                        {conv.title || 'Untitled Conversation'}
                      </p>
                      <div className="flex items-center gap-1.5 mt-1 text-[11px] text-slate-400 truncate">
                        {conv.knowledgeBaseName && (
                          <span className="truncate max-w-[110px]">{conv.knowledgeBaseName}</span>
                        )}
                        {conv.knowledgeBaseName && <span>•</span>}
                        <span className="inline-flex items-center gap-1 shrink-0">
                          <Clock size={10} />
                          {formatDateTime(conv.lastMessageAt || conv.createdAt)}
                        </span>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={(e) => handleDeleteConversation(e, conv._id)}
                      aria-label={`Delete conversation ${conv.title}`}
                      className="p-1 text-slate-400 hover:text-red-600 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity rounded"
                      title="Delete conversation"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </Card>

        {/* Right Column: Active RAG Conversation Interface */}
        <Card className="lg:col-span-9 border-slate-200 bg-white flex flex-col min-h-[600px] overflow-hidden">
          {/* Selected KB Context Header */}
          {selectedKb && (
            <div className="px-5 py-3.5 border-b border-slate-100 bg-slate-50/60 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <span className="text-sm font-semibold text-slate-900 truncate">
                  {selectedKb.name}
                </span>
                <VisibilityBadge visibility={selectedKb.visibility} />
                <StatusBadge status={selectedKb.status} />
              </div>

              <div className="flex items-center gap-2 text-xs text-slate-500">
                {selectedKb.department && <span>Dept: {selectedKb.department}</span>}
                <Link
                  to={`/knowledge-bases/${selectedKb._id}`}
                  className="text-primary-600 hover:text-primary-700 font-medium"
                >
                  Manage Docs &rarr;
                </Link>
              </div>
            </div>
          )}

          {/* Contextual Readiness Banners (Unindexed / Processing / Failed / Archived Docs) */}
          {isArchivedKb && (
            <div className="mx-5 mt-4 p-3.5 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <AlertCircle size={16} className="text-amber-600 shrink-0" />
                <span>
                  This knowledge base is <strong>archived</strong> and cannot accept new AI queries.
                  Select an active knowledge base above.
                </span>
              </div>
            </div>
          )}

          {showUnindexedNotice && !isArchivedKb && (
            <div
              className="mx-5 mt-4 p-4 rounded-lg bg-blue-50/70 border border-blue-200/80 text-xs text-slate-700 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
              role="status"
            >
              <div className="flex items-start gap-2.5">
                <Upload size={16} className="text-primary-600 shrink-0 mt-0.5" />
                <div>
                  {docStats.total === 0 ? (
                    <>
                      <p className="font-semibold text-slate-900">
                        No documents have been indexed in this knowledge base yet
                      </p>
                      <p className="text-slate-600 mt-0.5">
                        Upload PDF, DOCX, TXT, or Markdown documents to enable evidence-backed answers.
                      </p>
                    </>
                  ) : docStats.processing > 0 ? (
                    <>
                      <p className="font-semibold text-slate-900">
                        Documents are currently being processed &amp; indexed ({docStats.processing} in progress)
                      </p>
                      <p className="text-slate-600 mt-0.5">
                        Queries may return insufficient evidence until indexing finishes.
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="font-semibold text-slate-900">
                        No indexed documents available ({docStats.failed} failed indexing)
                      </p>
                      <p className="text-slate-600 mt-0.5">
                        Check document processing errors or re-index documents in the knowledge base view.
                      </p>
                    </>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {docStats.processing > 0 && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => refreshSelectedKbDocs(selectedKbId)}
                    className="gap-1.5 bg-white text-xs h-8"
                  >
                    <RefreshCw size={13} />
                    <span>Refresh</span>
                  </Button>
                )}
                <Link to={`/knowledge-bases/${selectedKb._id}`}>
                  <Button variant="primary" size="sm" className="gap-1.5 text-xs h-8">
                    <Upload size={13} />
                    <span>{docStats.total === 0 ? 'Upload Documents' : 'View Documents'}</span>
                  </Button>
                </Link>
              </div>
            </div>
          )}

          {/* Conversation Messages Stream */}
          <div className="flex-1 p-5 sm:p-6 overflow-y-auto space-y-5 bg-slate-50/30">
            {loadingConversation ? (
              <LoadingSpinner message="Loading conversation..." />
            ) : messages.length === 0 ? (
              <div className="max-w-xl mx-auto py-8 text-center space-y-6">
                <div className="inline-flex p-4 bg-primary-50 text-primary-600 rounded-2xl ring-8 ring-primary-50/40">
                  <Sparkles size={32} strokeWidth={1.75} />
                </div>
                <div className="space-y-2">
                  <h2 className="text-lg font-semibold text-slate-900">
                    Ask {selectedKb?.name || 'Your Knowledge Base'}
                  </h2>
                  <p className="text-sm text-slate-500 leading-relaxed">
                    Every response is synthesized solely from authorized documents inside this
                    knowledge base, complete with clickable citations and source excerpts.
                  </p>
                </div>

                {/* Starter Questions */}
                <div className="space-y-2 text-left">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 text-center">
                    Example Questions
                  </p>
                  <div className="grid grid-cols-1 gap-2">
                    {SUGGESTED_PROMPTS.map((promptText) => (
                      <button
                        key={promptText}
                        type="button"
                        disabled={isArchivedKb}
                        onClick={() => {
                          setQuestion(promptText);
                          inputRef.current?.focus();
                        }}
                        className="text-left text-xs text-slate-700 bg-white hover:bg-primary-50/60 hover:text-primary-700 hover:border-primary-300 border border-slate-200 rounded-lg px-3.5 py-2.5 transition-colors disabled:opacity-50"
                      >
                        {promptText}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              messages.map((msg, idx) => (
                <AssistantMessage
                  key={msg._id || msg.id || idx}
                  message={msg}
                  onSelectCitation={(cit) => setSelectedCitation(cit)}
                />
              ))
            )}

            {/* Loading Indicator While Querying RAG Engine */}
            {submitting && (
              <div
                className="flex justify-start items-start gap-3"
                role="status"
                aria-live="polite"
              >
                <div className="w-8 h-8 rounded-full bg-slate-100 border border-slate-200 text-primary-600 flex items-center justify-center shrink-0 mt-0.5">
                  <Bot size={16} />
                </div>
                <div className="bg-white border border-slate-200 rounded-2xl rounded-tl-sm px-4 py-3.5 shadow-sm flex items-center gap-3 text-sm text-slate-600">
                  <Loader2 size={16} className="animate-spin text-primary-600 shrink-0" />
                  <span>Searching authorized documents &amp; synthesizing grounded answer...</span>
                </div>
              </div>
            )}

            {/* Error State */}
            {submitError && (
              <div
                className="p-4 rounded-xl bg-red-50 border border-red-200 text-xs text-red-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                role="alert"
              >
                <div className="flex items-start gap-2.5">
                  {submitError.status === 403 ? (
                    <ShieldAlert size={18} className="text-red-600 shrink-0 mt-0.5" />
                  ) : (
                    <AlertCircle size={18} className="text-red-600 shrink-0 mt-0.5" />
                  )}
                  <div>
                    <p className="font-semibold text-red-900">
                      {submitError.status === 403 ? 'Access Denied' : 'Query Failed'}
                    </p>
                    <p className="text-red-700 mt-0.5">{submitError.message}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {lastSubmittedQuestion && submitError.status !== 403 && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => submitQuestionText(lastSubmittedQuestion)}
                      className="h-8 text-xs bg-white gap-1.5 border-red-200 text-red-700 hover:bg-red-100"
                    >
                      <RefreshCw size={12} />
                      <span>Retry</span>
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setSubmitError(null)}
                    className="h-8 text-xs text-red-700 hover:bg-red-100"
                  >
                    Dismiss
                  </Button>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Question Input & Submit Bar */}
          <form
            onSubmit={handleSubmit}
            className="p-4 border-t border-slate-200 bg-white space-y-2"
          >
            <div className="flex items-end gap-3">
              <div className="flex-1 relative">
                <label htmlFor="rag-question-input" className="sr-only">
                  Ask a question
                </label>
                <textarea
                  id="rag-question-input"
                  ref={inputRef}
                  rows={2}
                  maxLength={4000}
                  disabled={submitting || !selectedKbId || isArchivedKb}
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={
                    isArchivedKb
                      ? 'This knowledge base is archived...'
                      : `Ask a question about ${selectedKb?.name || 'this knowledge base'}...`
                  }
                  className="w-full resize-none rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent disabled:bg-slate-50 disabled:text-slate-400 transition-shadow"
                />
              </div>

              <Button
                type="submit"
                disabled={submitting || !question.trim() || !selectedKbId || isArchivedKb}
                className="h-11 px-5 gap-2 shrink-0"
              >
                {submitting ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    <span>Asking...</span>
                  </>
                ) : (
                  <>
                    <Send size={16} />
                    <span>Ask AI</span>
                  </>
                )}
              </Button>
            </div>

            <div className="flex items-center justify-between text-[11px] text-slate-400 px-1">
              <span>Press Enter to submit, Shift + Enter for a new line</span>
              {question.length > 3500 && <span>{question.length}/4000 characters</span>}
            </div>
          </form>
        </Card>
      </div>

      {/* Clickable Citation Detail Modal */}
      <CitationDetailModal
        citation={selectedCitation}
        isOpen={Boolean(selectedCitation)}
        onClose={() => setSelectedCitation(null)}
        knowledgeBaseId={selectedKbId}
      />
    </div>
  );
}
