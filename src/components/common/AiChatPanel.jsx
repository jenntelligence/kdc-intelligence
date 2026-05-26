import { useState, useEffect, useRef } from 'react';
import { Brain, X, Send } from 'lucide-react';

export const AiChatPanel = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState([
    { role: 'ai', text: 'Hello! I\'m your warehouse AI assistant. Ask me about pick rates, dock status, carrier performance, wave progress, or split shipments.' },
  ]);
  const [input, setInput] = useState('');
  const chatEndRef = useRef(null);

  const [isThinking, setIsThinking] = useState(false);

  // Auto-scroll to bottom when messages change or thinking state changes
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isThinking]);

  const handleSend = () => {
    if (!input.trim() || isThinking) return;
    const userMsg = input.trim();
    setMessages(prev => [...prev, { role: 'user', text: userMsg }]);
    setInput('');
    setIsThinking(true);

    fetch('http://localhost:3001/api/ai/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: userMsg }),
    })
      .then(r => r.json())
      .then(d => {
        const src = d.source === 'gemini' ? '' : ' [mock]';
        setMessages(prev => [...prev, { role: 'ai', text: d.response + src }]);
      })
      .catch(() => {
        setMessages(prev => [...prev, { role: 'ai', text: 'Unable to reach AI service. Make sure the API server is running (npm run server).' }]);
      })
      .finally(() => setIsThinking(false));
  };

  const suggestions = ["What's today's pick rate?", "Which dock is most behind?", "Carrier performance this week?"];

  return (
    <>
      {/* Floating button */}
      <button onClick={() => setIsOpen(!isOpen)}
        className="fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full bg-[#1ABC9C] text-[#0a0e12] flex items-center justify-center shadow-lg hover:bg-[#3d8de6] transition-colors"
        title="AI Assistant">
        {isOpen ? <X size={22}/> : <Brain size={22}/>}
      </button>

      {/* Chat panel */}
      {isOpen && (
        <div className="fixed bottom-24 right-6 z-50 w-96 h-[500px] bg-[#1a2129] border border-[#2d3744] rounded-lg shadow-2xl flex flex-col overflow-hidden">
          {/* Header */}
          <div className="flex items-center gap-2 px-4 py-3 border-b border-[#2d3744] bg-[#232c37]">
            <Brain size={16} className="text-[#1ABC9C]"/>
            <div className="text-[13px] font-semibold">KDC AI Assistant</div>
            <div className="ml-auto flex items-center gap-1">
              <div className="w-1.5 h-1.5 rounded-full bg-[#2ECC71] animate-pulse"/>
              <span className="text-[10px] font-mono text-[#8a95a3]">ONLINE</span>
            </div>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[80%] rounded-lg px-3 py-2 text-[13px] leading-relaxed ${
                  m.role === 'user'
                    ? 'bg-[#1ABC9C] text-[#0a0e12]'
                    : 'bg-[#232c37] border border-[#2d3744] text-[#e8ecef]'
                }`}>
                  {m.text}
                </div>
              </div>
            ))}
            {isThinking && (
              <div className="flex justify-start">
                <div className="bg-[#232c37] border border-[#2d3744] rounded-lg px-3 py-2 text-[13px] text-[#8a95a3] flex items-center gap-2">
                  <div className="flex gap-1">
                    <div className="w-1.5 h-1.5 rounded-full bg-[#1ABC9C] animate-bounce" style={{ animationDelay: '0ms' }}/>
                    <div className="w-1.5 h-1.5 rounded-full bg-[#1ABC9C] animate-bounce" style={{ animationDelay: '150ms' }}/>
                    <div className="w-1.5 h-1.5 rounded-full bg-[#1ABC9C] animate-bounce" style={{ animationDelay: '300ms' }}/>
                  </div>
                  Thinking...
                </div>
              </div>
            )}
            <div ref={chatEndRef}/>
          </div>

          {/* Suggestions */}
          {messages.length <= 2 && (
            <div className="px-4 pb-2 flex gap-1.5 flex-wrap">
              {suggestions.map((s, i) => (
                <button key={i} onClick={() => { setInput(s); }}
                  className="text-[11px] px-2 py-1 rounded border border-[#2d3744] text-[#8a95a3] hover:border-[#1ABC9C] hover:text-[#1ABC9C] transition-colors font-mono">
                  {s}
                </button>
              ))}
            </div>
          )}

          {/* Input */}
          <div className="flex items-center gap-2 px-4 py-3 border-t border-[#2d3744]">
            <input type="text" value={input} onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSend()}
              placeholder="Ask about warehouse ops..."
              className="flex-1 bg-[#0f1419] border border-[#2d3744] rounded px-3 py-2 text-[13px] focus:border-[#1ABC9C] outline-none text-[#e8ecef] placeholder-[#5d6b7a]"/>
            <button onClick={handleSend} className="w-8 h-8 rounded bg-[#1ABC9C] text-[#0a0e12] flex items-center justify-center hover:bg-[#3d8de6]">
              <Send size={14}/>
            </button>
          </div>
        </div>
      )}
    </>
  );
};
