
import React, { useState, useRef, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { GoogleGenAI, Modality, LiveServerMessage } from '@google/genai';
import { Mic, MicOff, FileText, Download, Trash2, Clock, Users, Calendar, CheckCircle, Save, Loader2, AlertCircle } from 'lucide-react';

// --- Types ---
interface TranscriptionEntry {
  role: 'user' | 'model';
  text: string;
  timestamp: Date;
}

interface AtaData {
  title: string;
  date: string;
  time: string;
  participants: string[];
  agenda: string;
  discussion: string;
  decisions: string;
  actionItems: string[];
}

// --- Audio Encoding Utils ---
function encode(bytes: Uint8Array) {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function createBlob(data: Float32Array): { data: string; mimeType: string } {
  const l = data.length;
  const int16 = new Int16Array(l);
  for (let i = 0; i < l; i++) {
    int16[i] = data[i] * 32768;
  }
  return {
    data: encode(new Uint8Array(int16.buffer)),
    mimeType: 'audio/pcm;rate=16000',
  };
}

const App: React.FC = () => {
  const [isRecording, setIsRecording] = useState(false);
  const [transcriptions, setTranscriptions] = useState<TranscriptionEntry[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [ata, setAta] = useState<AtaData | null>(null);
  const [recordingTime, setRecordingTime] = useState(0);
  const [error, setError] = useState<string | null>(null);
  
  const sessionPromiseRef = useRef<any>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);
  const currentTranscriptionRef = useRef({ user: '', model: '' });

  // Recording Timer
  useEffect(() => {
    if (isRecording) {
      timerRef.current = window.setInterval(() => {
        setRecordingTime(prev => prev + 1);
      }, 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [isRecording]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const startMeeting = async () => {
    setError(null);
    try {
      // 1. Verificar Microfone
      try {
        streamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (micErr: any) {
        throw new Error("Não foi possível acessar o microfone. Verifique as permissões de privacidade no seu navegador.");
      }

      // 2. Verificar API Key
      const apiKey = process.env.API_KEY;
      if (!apiKey || apiKey === "undefined") {
        throw new Error("A API_KEY não foi detectada. Certifique-se de que a variável de ambiente está configurada corretamente no Vercel.");
      }

      // 3. Inicializar Contexto de Áudio
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      const ai = new GoogleGenAI({ apiKey });

      setIsRecording(true);
      setRecordingTime(0);

      // 4. Conectar à API Live
      sessionPromiseRef.current = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        callbacks: {
          onopen: () => {
            if (!audioContextRef.current || !streamRef.current) return;
            const source = audioContextRef.current.createMediaStreamSource(streamRef.current);
            const scriptProcessor = audioContextRef.current.createScriptProcessor(4096, 1, 1);
            
            scriptProcessor.onaudioprocess = (e) => {
              const inputData = e.inputBuffer.getChannelData(0);
              const pcmBlob = createBlob(inputData);
              sessionPromiseRef.current?.then((session: any) => {
                session.sendRealtimeInput({ media: pcmBlob });
              }).catch((err: any) => console.error("Erro no envio do stream:", err));
            };
            
            source.connect(scriptProcessor);
            scriptProcessor.connect(audioContextRef.current.destination);
          },
          onmessage: async (message: LiveServerMessage) => {
            if (message.serverContent?.inputTranscription) {
              currentTranscriptionRef.current.user += message.serverContent.inputTranscription.text;
            } else if (message.serverContent?.outputTranscription) {
              currentTranscriptionRef.current.model += message.serverContent.outputTranscription.text;
            }

            if (message.serverContent?.turnComplete) {
              const uText = currentTranscriptionRef.current.user.trim();
              const mText = currentTranscriptionRef.current.model.trim();
              
              const newEntries: TranscriptionEntry[] = [];
              if (uText) newEntries.push({ role: 'user', text: uText, timestamp: new Date() });
              if (mText) newEntries.push({ role: 'model', text: mText, timestamp: new Date() });

              if (newEntries.length > 0) {
                setTranscriptions(prev => [...prev, ...newEntries]);
              }
              currentTranscriptionRef.current = { user: '', model: '' };
            }
          },
          onerror: (e) => {
            console.error('Live API Error:', e);
            setError("Erro na conexão em tempo real com o Gemini. Verifique sua chave de API.");
            stopMeeting();
          },
          onclose: () => setIsRecording(false),
        },
        config: {
          responseModalities: [Modality.AUDIO],
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          systemInstruction: 'Você é um assistente profissional que transcreve reuniões. Foque apenas em capturar o que é dito com precisão.',
        }
      });
    } catch (err: any) {
      console.error('Erro ao iniciar reunião:', err);
      setError(err.message || "Erro desconhecido ao tentar iniciar a sessão.");
      setIsRecording(false);
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
    }
  };

  const stopMeeting = async () => {
    setIsRecording(false);
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (audioContextRef.current) {
      if (audioContextRef.current.state !== 'closed') {
        await audioContextRef.current.close();
      }
      audioContextRef.current = null;
    }
    
    // Processar texto restante
    const uText = currentTranscriptionRef.current.user.trim();
    const mText = currentTranscriptionRef.current.model.trim();
    if (uText || mText) {
      const newEntries: TranscriptionEntry[] = [];
      if (uText) newEntries.push({ role: 'user', text: uText, timestamp: new Date() });
      if (mText) newEntries.push({ role: 'model', text: mText, timestamp: new Date() });
      setTranscriptions(prev => [...prev, ...newEntries]);
      currentTranscriptionRef.current = { user: '', model: '' };
    }
  };

  const generateAta = async () => {
    if (transcriptions.length === 0) return;
    setIsGenerating(true);
    setError(null);
    
    try {
      const apiKey = process.env.API_KEY;
      const ai = new GoogleGenAI({ apiKey });
      const fullTranscript = transcriptions.map(t => `${t.role === 'user' ? 'Participante' : 'IA'}: ${t.text}`).join('\n');
      
      const prompt = `Analise a transcrição abaixo e gere uma ATA DE REUNIÃO profissional e estruturada em JSON. Use português formal do Brasil.
      
      Estrutura esperada:
      {
        "title": "Título da Reunião",
        "date": "${new Date().toLocaleDateString('pt-BR')}",
        "time": "${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}",
        "participants": ["Nomes identificados"],
        "agenda": "Pauta da reunião",
        "discussion": "Resumo executivo das discussões",
        "decisions": "Pontos decididos e acordos",
        "actionItems": ["Tarefa/Ação - Responsável"]
      }

      Transcrição:
      ${fullTranscript}`;

      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: prompt,
        config: { responseMimeType: 'application/json' }
      });

      const result = JSON.parse(response.text || '{}');
      setAta(result);
    } catch (err) {
      console.error('Erro ao gerar ATA:', err);
      setError("Não foi possível gerar a ATA formatada. Verifique sua conexão.");
    } finally {
      setIsGenerating(false);
    }
  };

  const exportPDF = () => {
    if (!ata) return;
    const { jsPDF } = (window as any).jspdf;
    const doc = new jsPDF();
    
    doc.setFontSize(20);
    doc.text(ata.title, 20, 25);
    doc.setFontSize(10);
    doc.text(`Gerado via MinuteMaster AI | ${ata.date} ${ata.time}`, 20, 32);
    
    doc.setLineWidth(0.5);
    doc.line(20, 35, 190, 35);
    
    doc.setFontSize(12);
    doc.setFont(undefined, 'bold');
    doc.text('Participantes:', 20, 45);
    doc.setFont(undefined, 'normal');
    doc.text(ata.participants.join(', '), 20, 50);
    
    doc.setFont(undefined, 'bold');
    doc.text('Discussão:', 20, 60);
    doc.setFont(undefined, 'normal');
    const discLines = doc.splitTextToSize(ata.discussion, 170);
    doc.text(discLines, 20, 65);
    
    const yDecisions = 65 + (discLines.length * 6) + 10;
    doc.setFont(undefined, 'bold');
    doc.text('Decisões:', 20, yDecisions);
    doc.setFont(undefined, 'normal');
    const decLines = doc.splitTextToSize(ata.decisions, 170);
    doc.text(decLines, 20, yDecisions + 5);

    doc.save(`ATA_${ata.title.replace(/\s+/g, '_')}.pdf`);
  };

  return (
    <div className="min-h-screen bg-[#0f172a] text-slate-100 p-4 md:p-8 max-w-6xl mx-auto flex flex-col gap-6">
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800 pb-6">
        <div className="flex items-center gap-3">
          <div className="bg-indigo-600 p-2 rounded-xl shadow-lg shadow-indigo-500/20">
            <FileText className="w-8 h-8 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">MinuteMaster <span className="text-indigo-400">AI</span></h1>
            <p className="text-slate-400 text-sm">Ata de Reunião em Tempo Real</p>
          </div>
        </div>
        {ata && (
          <button onClick={exportPDF} className="bg-indigo-600 hover:bg-indigo-500 px-6 py-2.5 rounded-xl font-medium flex items-center gap-2 transition-all shadow-lg shadow-indigo-500/20">
            <Download className="w-4 h-4" /> Baixar PDF
          </button>
        )}
      </header>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-400 p-4 rounded-2xl flex items-start gap-3 animate-in fade-in slide-in-from-top-2">
          <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
          <div className="text-sm">
            <p className="font-bold">Atenção</p>
            <p className="opacity-90">{error}</p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 flex-grow">
        <div className="lg:col-span-4 flex flex-col gap-6">
          <div className="glass rounded-[2rem] p-8 flex flex-col items-center gap-8 shadow-2xl relative overflow-hidden">
            <div className="flex flex-col items-center gap-2">
              <span className={`text-6xl font-mono font-bold tracking-tighter ${isRecording ? 'text-red-500 drop-shadow-[0_0_15px_rgba(239,68,68,0.4)]' : 'text-slate-500'}`}>
                {formatTime(recordingTime)}
              </span>
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${isRecording ? 'bg-red-500 animate-pulse' : 'bg-slate-700'}`}></div>
                <p className="text-xs uppercase tracking-[0.2em] text-slate-500 font-bold">{isRecording ? 'Ouvindo Reunião' : 'Pronto para Iniciar'}</p>
              </div>
            </div>

            <button 
              onClick={isRecording ? stopMeeting : startMeeting}
              className={`w-40 h-40 rounded-full flex items-center justify-center transition-all duration-500 relative group ${
                isRecording 
                ? 'bg-red-500/10 border-4 border-red-500 shadow-[0_0_50px_rgba(239,68,68,0.2)]' 
                : 'bg-indigo-600 hover:bg-indigo-500 shadow-[0_0_40px_rgba(79,70,229,0.4)]'
              }`}
            >
              {isRecording ? <MicOff className="w-16 h-16 text-red-500" /> : <Mic className="w-16 h-16 text-white" />}
              <div className={`absolute inset-0 rounded-full border-4 border-white/10 scale-110 transition-transform duration-500 ${isRecording ? 'animate-ping' : 'group-hover:scale-125'}`}></div>
            </button>

            <div className="w-full flex flex-col gap-3">
              <button 
                disabled={isRecording || transcriptions.length === 0 || isGenerating}
                onClick={generateAta}
                className="w-full bg-slate-100 hover:bg-white disabled:opacity-30 disabled:cursor-not-allowed text-slate-900 py-4 rounded-2xl font-bold flex items-center justify-center gap-2 transition-all shadow-xl"
              >
                {isGenerating ? <Loader2 className="w-5 h-5 animate-spin" /> : <CheckCircle className="w-5 h-5" />}
                Processar e Gerar Ata
              </button>
              
              <button 
                onClick={() => { setTranscriptions([]); setAta(null); setRecordingTime(0); setError(null); }}
                className="w-full bg-slate-800/40 hover:bg-slate-800 text-slate-400 py-3 rounded-2xl text-xs font-bold transition-all border border-slate-700/50 flex items-center justify-center gap-2"
              >
                <Trash2 className="w-4 h-4" /> Resetar Sessão
              </button>
            </div>
          </div>

          <div className="glass rounded-[2rem] p-6 flex-grow flex flex-col gap-4 max-h-[350px]">
            <h3 className="text-xs font-black text-slate-500 uppercase tracking-widest flex items-center gap-2 px-2">
              <Clock className="w-4 h-4" /> Histórico de Falas
            </h3>
            <div className="flex-grow overflow-y-auto custom-scrollbar space-y-4 pr-2">
              {transcriptions.length === 0 && !isRecording && (
                <div className="h-full flex flex-col items-center justify-center text-slate-600 text-sm italic">
                  Nenhuma fala capturada ainda...
                </div>
              )}
              {transcriptions.map((t, i) => (
                <div key={i} className={`flex flex-col ${t.role === 'user' ? 'items-start' : 'items-end'}`}>
                  <div className={`max-w-[90%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                    t.role === 'user' ? 'bg-slate-800/80 border border-slate-700' : 'bg-indigo-900/30 border border-indigo-500/20 text-indigo-100'
                  }`}>
                    {t.text}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="lg:col-span-8 flex flex-col">
          {ata ? (
            <div className="glass rounded-[2rem] p-8 md:p-12 flex-grow flex flex-col gap-10 overflow-y-auto custom-scrollbar shadow-2xl animate-in fade-in zoom-in duration-500">
              <div className="space-y-2">
                <h2 className="text-4xl font-black text-white leading-tight">{ata.title}</h2>
                <div className="flex flex-wrap gap-4 text-xs font-bold text-slate-500 uppercase tracking-widest">
                  <span className="flex items-center gap-2 bg-slate-800/50 px-3 py-1.5 rounded-lg"><Calendar className="w-4 h-4" /> {ata.date}</span>
                  <span className="flex items-center gap-2 bg-slate-800/50 px-3 py-1.5 rounded-lg"><Clock className="w-4 h-4" /> {ata.time}</span>
                  <span className="flex items-center gap-2 bg-slate-800/50 px-3 py-1.5 rounded-lg"><Users className="w-4 h-4" /> {ata.participants.length} Presentes</span>
                </div>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
                <section className="space-y-4">
                  <h3 className="text-indigo-400 font-black text-sm uppercase tracking-widest flex items-center gap-2">
                    <Users className="w-5 h-5" /> Participantes
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    {ata.participants.map((p, i) => (
                      <span key={i} className="bg-slate-800/80 px-4 py-2 rounded-xl text-xs font-bold border border-slate-700">{p}</span>
                    ))}
                  </div>
                </section>
                <section className="space-y-4">
                  <h3 className="text-indigo-400 font-black text-sm uppercase tracking-widest flex items-center gap-2">
                    <Save className="w-5 h-5" /> Pauta Central
                  </h3>
                  <p className="text-sm text-slate-300 leading-relaxed font-medium">{ata.agenda}</p>
                </section>
              </div>

              <section className="space-y-4">
                <h3 className="text-indigo-400 font-black text-sm uppercase tracking-widest">Resumo das Discussões</h3>
                <div className="bg-slate-800/30 p-8 rounded-3xl border border-slate-700/50 text-slate-300 text-sm leading-8 shadow-inner italic">
                  "{ata.discussion}"
                </div>
              </section>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
                <section className="space-y-4">
                  <h3 className="text-green-400 font-black text-sm uppercase tracking-widest flex items-center gap-2">
                    <CheckCircle className="w-5 h-5" /> Decisões Finais
                  </h3>
                  <div className="bg-green-500/5 p-6 rounded-2xl border border-green-500/10 text-sm text-slate-300 leading-relaxed">
                    {ata.decisions}
                  </div>
                </section>
                <section className="space-y-4">
                  <h3 className="text-orange-400 font-black text-sm uppercase tracking-widest flex items-center gap-2">
                    <FileText className="w-5 h-5" /> Próximos Passos
                  </h3>
                  <ul className="space-y-3">
                    {ata.actionItems.map((item, i) => (
                      <li key={i} className="bg-orange-500/5 p-4 rounded-xl border border-orange-500/10 text-sm flex gap-4 items-center">
                        <span className="w-6 h-6 rounded-full bg-orange-500/20 text-orange-400 flex items-center justify-center text-[10px] font-black">{i+1}</span>
                        <span className="text-slate-300 font-medium">{item}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              </div>
            </div>
          ) : (
            <div className="glass rounded-[2rem] p-12 flex flex-col items-center justify-center flex-grow text-center text-slate-600 border-dashed border-4 border-slate-800/30 bg-transparent">
              <div className="bg-slate-800/50 p-8 rounded-full mb-6 border border-slate-700/50">
                <Mic className="w-20 h-20 opacity-10" />
              </div>
              <h2 className="text-2xl font-black text-slate-400 mb-4 tracking-tight">O Assistente está de Prontidão</h2>
              <p className="max-w-sm mx-auto text-sm leading-relaxed font-medium opacity-60">
                Ligue o microfone e inicie sua conferência. Nossa IA cuidará de identificar os pontos chaves e gerar um documento formal para você.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

createRoot(document.getElementById('root')!).render(<App />);
