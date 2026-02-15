'use client';

import { useState, useRef, useEffect} from 'react';
import { api } from '@/lib/apiClient';
import type { Case } from '@/types/api';

type Message = {
  role: 'user' | 'assistant';
  content: string;
};

export function ChatAssistant({ caseId, onUpdated }: { caseId?: string; onUpdated?: (c: Case) => void }) {
  const [isOpen, setIsOpen] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    { role: 'assistant', content: caseId 
      ? 'この案件について修正指示や質問があればどうぞ。' 
      : '全案件を見渡すPMエージェントです。何か知りたいことはありますか？' 
    }
  ]);

  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isOpen]);  

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || loading) return;

    const userMsg = input;
    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: userMsg }]);
    setLoading(true);
    try {
      let reply = "";
      
      if (caseId) {
        const res = await api.chatAssistant(caseId, userMsg);
        reply = res.reply;
        if (res.updated_case && onUpdated) {
            onUpdated(res.updated_case);
        }
    } else {
        const res = await api.chatGlobal(userMsg);
        reply = res.reply;
    }

      setMessages(prev => [...prev, { role: 'assistant', content: reply }]);
    } catch (err: any) {
      setMessages(prev => [...prev, { role: 'assistant', content: `Error: ${err.message}` }]);
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-6 right-6 z-50 h-14 w-14 rounded-full bg-indigo-600 hover:bg-indigo-700 text-white shadow-lg flex items-center justify-center text-2xl transition-transform hover:scale-110"
      >
        ✨
      </button>
    );
  }
  
  return (
    <div className={`fixed z-50 bg-white rounded-xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col animate-in fade-in duration-200 
      ${isMaximized 
        ? 'inset-4 w-auto h-auto rounded-xl' 
        : 'bottom-6 right-6 w-96 h-[500px]'   
      }
    `}>      
      <div className={`p-3 flex justify-between items-center text-white cursor-pointer ${caseId ? 'bg-indigo-600' : 'bg-slate-800'}`}
           onDoubleClick={() => setIsMaximized(!isMaximized)}
      >
        <span className="font-bold text-sm flex items-center gap-2">
          {caseId ? '📝 Case Editor' : '🕶️ Project Manager'}
        </span>
        <div className="flex items-center gap-2">
          <button onClick={() => setIsMaximized(!isMaximized)} className="text-white/70 hover:text-white font-mono">
            {isMaximized ? '❐' : '□'}
          </button>
          <button onClick={() => setIsOpen(false)} className="text-white/70 hover:text-white">✕</button>
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 bg-slate-50 space-y-4">        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap ${
              m.role === 'user' 
                ? 'bg-indigo-600 text-white rounded-tr-none' 
                : 'bg-white border border-gray-200 text-gray-800 rounded-tl-none shadow-sm'
            }`}>
              {m.content}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="bg-gray-200 text-gray-500 text-xs px-3 py-1 rounded-full animate-pulse">
              AI is thinking...
            </div>
          </div>
        )}
      </div>

      <form onSubmit={handleSubmit} className="p-3 border-t bg-white flex gap-2">
        <input
          className="flex-1 border rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          placeholder="メッセージを入力..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          autoFocus
        />
        <button 
          type="submit" 
          disabled={loading}
          className="bg-indigo-600 text-white px-4 py-2 rounded text-sm hover:bg-indigo-700 disabled:opacity-50 font-bold"
        >
          ➤
        </button>
      </form>
    </div>
  );
}
