import React from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AiAssistant from '../AiAssistant';
import api from '../../../services/api';

const renderAssistant = (initialRoute = '/assistant') => {
  return render(
    <MemoryRouter initialEntries={[initialRoute]}>
      <Routes>
        <Route path="/assistant" element={<AiAssistant />} />
        <Route path="/knowledge-bases/:id" element={<div>KB Detail Page</div>} />
        <Route path="/knowledge-bases/create" element={<div>Create KB Page</div>} />
      </Routes>
    </MemoryRouter>
  );
};

describe('AiAssistant Frontend Integration', () => {
  const sampleKb = {
    _id: 'kb_eng_1',
    name: 'Engineering Handbook',
    description: 'Architecture and security standards',
    visibility: 'organization',
    status: 'active',
    department: 'Engineering',
  };

  const sampleDoc = {
    _id: 'doc_tls_1',
    title: 'Security Standards 2026',
    originalFileName: 'security_standards.pdf',
    fileType: 'pdf',
    fileSize: 204800,
    pageCount: 12,
    wordCount: 3400,
    chunksCount: 6,
    processingStatus: 'processed',
    indexingStatus: 'indexed',
    knowledgeBase: 'kb_eng_1',
    uploadedBy: { name: 'Alice Owner' },
    createdAt: '2026-11-20T10:00:00Z',
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders empty state when user has no accessible knowledge bases', async () => {
    vi.spyOn(api, 'get').mockImplementation((url) => {
      if (url === '/knowledge-bases') return Promise.resolve({ data: { status: 'success', data: [] } });
      if (url === '/conversations') return Promise.resolve({ data: { status: 'success', data: [] } });
      return Promise.resolve({ data: { data: [] } });
    });

    renderAssistant();

    expect(await screen.findByText(/No Knowledge Bases available/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Create Knowledge Base/i })).toBeInTheDocument();
  });

  it('shows useful banner when selected knowledge base has no indexed documents yet', async () => {
    vi.spyOn(api, 'get').mockImplementation((url) => {
      if (url === '/knowledge-bases') {
        return Promise.resolve({ data: { status: 'success', data: [sampleKb] } });
      }
      if (url === '/conversations') {
        return Promise.resolve({ data: { status: 'success', data: [] } });
      }
      if (url === `/knowledge-bases/${sampleKb._id}/documents`) {
        return Promise.resolve({ data: { status: 'success', data: [] } });
      }
      return Promise.resolve({ data: { data: [] } });
    });

    renderAssistant();

    expect(
      await screen.findByText(/No documents have been indexed in this knowledge base yet/i)
    ).toBeInTheDocument();
    expect(screen.getByText('0 indexed docs')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Upload Documents/i })).toBeInTheDocument();
  });

  it('submits question to Node.js RAG endpoint, displays loading, answer, citations, and opens clickable source detail modal', async () => {
    const user = userEvent.setup();

    vi.spyOn(api, 'get').mockImplementation((url) => {
      if (url === '/knowledge-bases') {
        return Promise.resolve({ data: { status: 'success', data: [sampleKb] } });
      }
      if (url === '/conversations') {
        return Promise.resolve({ data: { status: 'success', data: [] } });
      }
      if (url === `/knowledge-bases/${sampleKb._id}/documents`) {
        return Promise.resolve({ data: { status: 'success', data: [sampleDoc] } });
      }
      if (url === `/documents/${sampleDoc._id}`) {
        return Promise.resolve({ data: { status: 'success', data: sampleDoc } });
      }
      return Promise.resolve({ data: { data: [] } });
    });

    let resolveRagPost;
    const ragPromise = new Promise((resolve) => {
      resolveRagPost = resolve;
    });
    const postSpy = vi.spyOn(api, 'post').mockImplementation(() => ragPromise);

    renderAssistant();

    expect(await screen.findByText('1 indexed doc')).toBeInTheDocument();

    const input = screen.getByLabelText('Ask a question');
    await user.type(input, 'What TLS version is mandatory?');

    const submitBtn = screen.getByRole('button', { name: /Ask AI/i });
    await user.click(submitBtn);

    // Loading state visible while awaiting response
    expect(
      await screen.findByText(/Searching authorized documents & synthesizing grounded answer/i)
    ).toBeInTheDocument();

    expect(postSpy).toHaveBeenCalledWith('/rag/query', {
      question: 'What TLS version is mandatory?',
      knowledgeBaseId: 'kb_eng_1',
    });

    // Resolve with real structured RAG response
    resolveRagPost({
      data: {
        status: 'success',
        data: {
          answer: 'All microservices must enforce TLS 1.3 [1].',
          citations: [
            {
              document_id: 'doc_tls_1',
              filename: 'security_standards.pdf',
              title: 'Security Standards 2026',
              chunk_id: 'chunk_004',
              page_number: 4,
              excerpt:
                'Production APIs and internal microservices must enforce TLS 1.3 with strong cipher suites across all environments.',
              score: 0.92,
            },
          ],
          metadata: {
            knowledge_base_id: 'kb_eng_1',
            chunks_retrieved: 3,
            chunks_used: 1,
            model: 'gemini-2.5-flash',
            similarity_threshold: 0.65,
            insufficient_evidence: false,
          },
          conversationId: 'conv_999',
        },
      },
    });

    expect(await screen.findByText('All microservices must enforce TLS 1.3 [1].')).toBeInTheDocument();
    expect(screen.getByText('Sources (1)')).toBeInTheDocument();
    expect(screen.getByText('Page 4')).toBeInTheDocument();
    expect(screen.getByText('92% match')).toBeInTheDocument();

    // Clickable source details opens modal and loads authoritative document metadata
    await user.click(screen.getByRole('button', { name: /View source details for Security Standards 2026/i }));

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(await within(dialog).findByText('security_standards.pdf')).toBeInTheDocument();
    expect(within(dialog).getByText('Alice Owner')).toBeInTheDocument();
    expect(within(dialog).getByText('Matched Source Excerpt')).toBeInTheDocument();
  });

  it('displays insufficient-evidence callout when RAG returns insufficient_evidence=true', async () => {
    const user = userEvent.setup();

    vi.spyOn(api, 'get').mockImplementation((url) => {
      if (url === '/knowledge-bases') {
        return Promise.resolve({ data: { status: 'success', data: [sampleKb] } });
      }
      if (url === '/conversations') {
        return Promise.resolve({ data: { status: 'success', data: [] } });
      }
      if (url === `/knowledge-bases/${sampleKb._id}/documents`) {
        return Promise.resolve({ data: { status: 'success', data: [sampleDoc] } });
      }
      return Promise.resolve({ data: { data: [] } });
    });

    vi.spyOn(api, 'post').mockResolvedValue({
      data: {
        status: 'success',
        data: {
          answer: 'I do not have sufficient evidence in the provided documents to answer this question.',
          citations: [],
          metadata: {
            knowledge_base_id: 'kb_eng_1',
            chunks_retrieved: 2,
            chunks_used: 0,
            model: 'gemini-2.5-flash',
            similarity_threshold: 0.65,
            insufficient_evidence: true,
          },
          conversationId: 'conv_insufficient',
        },
      },
    });

    renderAssistant();

    const input = await screen.findByLabelText('Ask a question');
    await user.type(input, 'What is the cafeteria menu for Friday?');
    await user.click(screen.getByRole('button', { name: /Ask AI/i }));

    expect(await screen.findByText('Insufficient Evidence')).toBeInTheDocument();
    expect(
      screen.getByText(/I do not have sufficient evidence in the provided documents/i)
    ).toBeInTheDocument();
  });

  it('renders access-denied (403) error state cleanly without losing user question', async () => {
    const user = userEvent.setup();

    vi.spyOn(api, 'get').mockImplementation((url) => {
      if (url === '/knowledge-bases') {
        return Promise.resolve({ data: { status: 'success', data: [sampleKb] } });
      }
      if (url === '/conversations') {
        return Promise.resolve({ data: { status: 'success', data: [] } });
      }
      if (url === `/knowledge-bases/${sampleKb._id}/documents`) {
        return Promise.resolve({ data: { status: 'success', data: [sampleDoc] } });
      }
      return Promise.resolve({ data: { data: [] } });
    });

    const forbiddenErr = new Error('Forbidden');
    forbiddenErr.response = {
      status: 403,
      data: { status: 'fail', message: 'Not authorized to access this Knowledge Base' },
    };
    vi.spyOn(api, 'post').mockRejectedValue(forbiddenErr);

    renderAssistant();

    const input = await screen.findByLabelText('Ask a question');
    await user.type(input, 'Secret data?');
    await user.click(screen.getByRole('button', { name: /Ask AI/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Access Denied');
    expect(screen.getByRole('alert')).toHaveTextContent('Not authorized to access this Knowledge Base');
    // Question restored into input on failure
    expect(screen.getByLabelText('Ask a question')).toHaveValue('Secret data?');
  });

  it('loads and switches historical conversations from backend and deletes cleanly', async () => {
    const user = userEvent.setup();

    const convSummary = {
      _id: 'conv_hist_1',
      title: 'Previous Deployment Policy',
      knowledgeBase: 'kb_eng_1',
      knowledgeBaseName: 'Engineering Handbook',
      messageCount: 2,
      lastMessageAt: '2026-11-24T12:00:00Z',
    };

    const convDetail = {
      ...convSummary,
      messages: [
        { _id: 'm1', role: 'user', content: 'How do we deploy?', citations: [] },
        {
          _id: 'm2',
          role: 'assistant',
          content: 'Deployments require automated CI checks first [1].',
          citations: [
            {
              document_id: 'doc_tls_1',
              filename: 'security_standards.pdf',
              title: 'Security Standards 2026',
              chunk_id: 'chunk_009',
              page_number: 8,
              excerpt: 'All production deployments require passing CI checks.',
              score: 0.88,
            },
          ],
          metadata: { model: 'gemini-2.5-flash', chunks_retrieved: 1, chunks_used: 1 },
        },
      ],
    };

    vi.spyOn(api, 'get').mockImplementation((url) => {
      if (url === '/knowledge-bases') {
        return Promise.resolve({ data: { status: 'success', data: [sampleKb] } });
      }
      if (url === '/conversations') {
        return Promise.resolve({ data: { status: 'success', data: [convSummary] } });
      }
      if (url === `/knowledge-bases/${sampleKb._id}/documents`) {
        return Promise.resolve({ data: { status: 'success', data: [sampleDoc] } });
      }
      if (url === `/conversations/${convSummary._id}`) {
        return Promise.resolve({ data: { status: 'success', data: convDetail } });
      }
      return Promise.resolve({ data: { data: [] } });
    });

    const deleteSpy = vi.spyOn(api, 'delete').mockResolvedValue({
      data: { status: 'success', message: 'Conversation deleted successfully' },
    });

    renderAssistant();

    // Historical conversation appears in sidebar
    const historyItem = await screen.findByText('Previous Deployment Policy');
    await user.click(historyItem);

    // Persisted messages and citations appear
    expect(await screen.findByText('How do we deploy?')).toBeInTheDocument();
    expect(
      screen.getByText('Deployments require automated CI checks first [1].')
    ).toBeInTheDocument();
    expect(screen.getByText('Page 8')).toBeInTheDocument();

    // Delete conversation
    const deleteBtn = screen.getByRole('button', {
      name: /Delete conversation Previous Deployment Policy/i,
    });
    await user.click(deleteBtn);

    await waitFor(() => {
      expect(deleteSpy).toHaveBeenCalledWith('/conversations/conv_hist_1');
      expect(screen.queryByText('Previous Deployment Policy')).not.toBeInTheDocument();
    });
  });

  it('shows processing banner when documents are still indexing and handles citation metadata 403 safely', async () => {
    const user = userEvent.setup();

    const processingDoc = {
      ...sampleDoc,
      _id: 'doc_proc_1',
      indexingStatus: 'processing',
    };

    vi.spyOn(api, 'get').mockImplementation((url) => {
      if (url === '/knowledge-bases') {
        return Promise.resolve({ data: { status: 'success', data: [sampleKb] } });
      }
      if (url === '/conversations') {
        return Promise.resolve({ data: { status: 'success', data: [] } });
      }
      if (url === `/knowledge-bases/${sampleKb._id}/documents`) {
        return Promise.resolve({ data: { status: 'success', data: [processingDoc] } });
      }
      if (url === '/documents/doc_restricted_1') {
        const err = new Error('Forbidden');
        err.response = { status: 403, data: { message: 'Not authorized' } };
        return Promise.reject(err);
      }
      return Promise.resolve({ data: { data: [] } });
    });

    vi.spyOn(api, 'post').mockResolvedValue({
      data: {
        status: 'success',
        data: {
          answer: 'Partial match found [1].',
          citations: [
            {
              document_id: 'doc_restricted_1',
              filename: 'restricted.pdf',
              title: 'Restricted Spec',
              page_number: 2,
              excerpt: 'Restricted excerpt snippet.',
              score: 0.77,
            },
          ],
          metadata: {
            knowledge_base_id: 'kb_eng_1',
            chunks_retrieved: 1,
            chunks_used: 1,
            model: 'gemini-2.5-flash',
            similarity_threshold: 0.65,
            insufficient_evidence: false,
          },
          conversationId: 'conv_proc',
        },
      },
    });

    renderAssistant();

    expect(
      await screen.findByText(/Documents are currently being processed & indexed/i)
    ).toBeInTheDocument();

    const input = screen.getByLabelText('Ask a question');
    await user.type(input, 'Check status?');
    await user.click(screen.getByRole('button', { name: /Ask AI/i }));

    await user.click(
      await screen.findByRole('button', { name: /View source details for Restricted Spec/i })
    );

    expect(
      await screen.findByText(/Access denied: you do not have permission to view full metadata for this document/i)
    ).toBeInTheDocument();
  });
});
