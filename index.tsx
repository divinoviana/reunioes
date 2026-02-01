
import React, { useState, useRef, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { GoogleGenAI, Modality, LiveServerMessage } from '@google/genai';
import { createClient } from '@supabase/supabase-js';
import { Mic, MicOff, FileText, Download, Trash2, Clock, Users, Calendar, CheckCircle, Save, Loader2, AlertCircle, Cloud } from 'lucide-react';

// Supabase Configuration
const SUPABASE_URL = 'https://jonuyirnloracjxxuwxw.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_HXEhFQFfZen-1_7-Qs4bcA_fnudTOCO';
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// --- Types ---
interface TranscriptionEntry {
  role: 'user' | 'model';
  text: string;
  timestamp: Date;
}

interface AtaData {
  id?: string;
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
  const [isSaving, setIsSaving] = useState(false);
  const [ata, setAta] = useState<AtaData | null>(null);
  const [recordingTime, setRecordingTime] = useState(0);
  const [error, setError] = useState<string | null>(null);
  
  const sessionPromiseRef = useRef<any>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);
  const currentTranscriptionRef = useRef({ user: '', model: '' });
  const meetingIdRef = useRef<string | null>(null);

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

  const saveTranscriptionToSupabase = async (entry: TranscriptionEntry) => {
    if (!meetingIdRef.current) return;
    try {
      await supabase.from('transcriptions').insert([{
        meeting_id: meetingIdRef.current,
        role: entry.role,
        text: entry.text,
        timestamp: entry.timestamp.toISOString()
      }]);
    } catch (err) {
      console.error('Erro ao salvar transcrição:', err);
    }
  };

  const startMeeting = async () => {
    setError(null);
    try {
      // 1. Verificar Microfone
      try {
        streamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (micErr: any) {
        throw new Error("Não foi possível acessar o microfone.");
      }

      // 2. Inicializar Gemini (A chave vem diretamente do ambiente)
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      
      meetingIdRef.current = crypto.randomUUID();
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });

      setIsRecording(true);
      setRecordingTime(0);

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
              });
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
              
              if (uText) {
                const entry: TranscriptionEntry = { role: 'user', text: uText, timestamp: new Date() };
                setTranscriptions(prev => [...prev, entry]);
                saveTranscriptionToSupabase(entry);
              }
              if (mText) {
                const entry: TranscriptionEntry = { role: 'model', text: mText, timestamp: new Date() };
                setTranscriptions(prev => [...prev, entry]);
                saveTranscriptionToSupabase(entry);
              }
              currentTranscriptionRef.current = { user: '', model: '' };
            }
          },
          onerror: (e) => {
            console.error('Gemini Error:', e);
            setError("Erro na conexão com o Gemini. Verifique se a chave API_KEY está correta no Vercel.");
            stopMeeting();
          }
        },
        config: {
          responseModalities: [Modality.AUDIO],
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          systemInstruction: 'Você é um assistente profissional. Transcreva a reunião fielmente.',
        }
      });
    } catch (err: any) {
      console.error('Erro ao iniciar:', err);
      setError(err.message || "Erro inesperado.");
      setIsRecording(false);
    }
  };

  const stopMeeting = async () => {
    setIsRecording(false);
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (audioContextRef.current) {
      if (audioContextRef.current.state !== 'closed') await audioContextRef.current.close();
      audioContextRef.current = null;
    }
  };

  const generateAta = async () => {
    if (transcriptions.length === 0) return;
    setIsGenerating(true);
    setIsSaving(true);
    setError(null);
    
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const fullTranscript = transcriptions.map(t => `${t.role === 'user' ? 'Participante' : 'IA'}: ${t.text}`).join('\n');
      
      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: `Gere uma ATA DE REUNIÃO em JSON baseado nesta transcrição: ${fullTranscript}`,
        config: { 
          responseMimeType: 'application/json',
          responseSchema: {
            type: "OBJECT",
            properties: {
              title: { type: "STRING" },
              date: { type: "STRING" },
              time: { type: "STRING" },
              participants: { type: "ARRAY", items: { type: "STRING" } },
              agenda: { type: "STRING" },
              discussion: { type: "STRING" },
              decisions: { type: "STRING" },
              actionItems: { type: "ARRAY", items: { type: "STRING" } }
            },
            required: ["title", "date", "time", "participants", "agenda", "discussion", "decisions", "actionItems"]
          }
        }
      });

      const result = JSON.parse(response.text || '{}');
      setAta(result);

      // Salvar ATA no Supabase
      const { error: dbError } = await supabase.from('meetings').insert([{
        id: meetingIdRef.current,
        title: result.title,
        date: result.date,
        time: result.time,
        participants: result.participants,
        agenda: result.agenda,
        discussion: result.discussion,
        decisions: result.decisions,
        action_items: result.actionItems
      }]);
      
      if (dbError) throw dbError;
    } catch (err: any) {
      console.error('Erro ao gerar/salvar:', err);
      setError("Falha ao processar ou salvar os dados no Supabase.");
    } finally {
      setIsGenerating(false);
      setIsSaving(false);
    }
  };

  const exportPDF = () => {
    if (!ata) return;
    const { jsPDF } = (window as any).jspdf;
    const doc = new jsPDF();
    doc.setFontSize(20);
    doc.text(ata.title, 20, 25);
    doc.setFontSize(10);
    doc.text(`ID Reunião: ${meetingIdRef.current?.slice(0, 8)}`, 20, 32);
    doc.line(20, 35, 190, 35);
    doc.setFontSize(12);
    doc.text(`Data: ${ata.date} | Hora: ${ata.time}`, 20, 45);
    doc.text(`Participantes: ${ata.participants.join(', ')}`, 20, 55);
    doc.text('Discussão:', 20, 70);
    const discLines = doc.splitTextToSize(ata.discussion, 170);
    doc.text(discLines, 20, 75);
    doc.save(`ATA_${ata.title}.pdf`);
  };

  return (
    <div className="min-h-screen bg-[#0f172a] text-slate-100 p-4 md:p-8 max-w-6xl mx-auto flex flex-col gap-6">
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800 pb-6">
        <div className="flex items-center gap-3">
          <div className="bg-indigo-600 p-2 rounded-xl shadow-lg">
            <FileText className="w-8 h-8 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">MinuteMaster <span className="text-indigo-400">AI</span></h1>
            <div className="flex items-center gap-2 text-slate-400 text-sm">
              <Cloud className="w-3 h-3 text-emerald-400" />
              <span>Supabase Cloud Conectado</span>
            </div>
          </div>
        </div>
        {ata && (
          <button onClick={exportPDF} className="bg-indigo-600 hover:bg-indigo-500 px-6 py-2 rounded-xl font-bold transition-all flex items-center gap-2">
            <Download className="w-4 h-4" /> Baixar PDF
          </button>
        )}
      </header>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-400 p-4 rounded-2xl flex items-start gap-3">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <p className="text-sm font-medium">{error}</p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 flex-grow">
        <div className="lg:col-span-4 flex flex-col gap-6">
          <div className="glass rounded-[2rem] p-8 flex flex-col items-center gap-8 shadow-2xl">
            <div className="flex flex-col items-center gap-2">
              <span className={`text-6xl font-mono font-bold tracking-tighter ${isRecording ? 'text-red-500 drop-shadow-[0_0_15px_rgba(239,68,68,0.4)]' : 'text-slate-500'}`}>
                {formatTime(recordingTime)}
              </span>
              <p className="text-xs font-black uppercase tracking-widest text-slate-500">{isRecording ? 'Gravando...' : 'Microfone Pronto'}</p>
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
              <div className={`absolute inset-0 rounded-full border-4 border-white/10 scale-110 ${isRecording ? 'animate-ping' : ''}`}></div>
            </button>

            <div className="w-full space-y-3">
              <button 
                disabled={isRecording || transcriptions.length === 0 || isGenerating}
                onClick={generateAta}
                className="w-full bg-slate-100 hover:bg-white disabled:opacity-30 text-slate-900 py-4 rounded-2xl font-bold flex items-center justify-center gap-2 transition-all shadow-xl"
              >
                {isGenerating || isSaving ? <Loader2 className="w-5 h-5 animate-spin" /> : <CheckCircle className="w-5 h-5" />}
                {isSaving ? 'Salvando no Banco...' : 'Gerar ATA e Salvar'}
              </button>
              <button 
                onClick={() => { setTranscriptions([]); setAta(null); setRecordingTime(0); setError(null); }}
                className="w-full bg-slate-800/50 hover:bg-slate-800 text-slate-400 py-3 rounded-2xl text-xs font-bold transition-all border border-slate-700/50"
              >
                Limpar Tudo
              </button>
            </div>
          </div>

          <div className="glass rounded-[2rem] p-6 flex-grow flex flex-col gap-4 max-h-[300px]">
            <h3 className="text-xs font-black text-slate-500 uppercase tracking-widest flex items-center gap-2">
              <Clock className="w-4 h-4" /> Transcrição Real
            </h3>
            <div className="flex-grow overflow-y-auto custom-scrollbar space-y-4 pr-2">
              {transcriptions.map((t, i) => (
                <div key={i} className={`flex flex-col ${t.role === 'user' ? 'items-start' : 'items-end'}`}>
                  <div className={`max-w-[90%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                    t.role === 'user' ? 'bg-slate-800 border border-slate-700' : 'bg-indigo-900/30 border border-indigo-500/20'
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
              <div className="space-y-2 border-b border-slate-800 pb-8">
                <div className="text-indigo-400 font-bold text-xs uppercase tracking-widest flex items-center gap-2">
                   <CheckCircle className="w-4 h-4" /> ATA Sincronizada
                </div>
                <h2 className="text-4xl font-black text-white">{ata.title}</h2>
                <div className="flex flex-wrap gap-4 text-xs font-bold text-slate-500 uppercase tracking-widest">
                  <span className="bg-slate-800/50 px-3 py-1.5 rounded-lg flex items-center gap-2"><Calendar className="w-4 h-4" /> {ata.date}</span>
                  <span className="bg-slate-800/50 px-3 py-1.5 rounded-lg flex items-center gap-2"><Clock className="w-4 h-4" /> {ata.time}</span>
                </div>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
                <section>
                  <h3 className="text-indigo-400 font-black text-xs uppercase mb-4 tracking-widest">Participantes</h3>
                  <div className="flex flex-wrap gap-2">
                    {ata.participants.map((p, i) => (
                      <span key={i} className="bg-slate-800 border border-slate-700 px-4 py-2 rounded-xl text-xs font-bold">{p}</span>
                    ))}
                  </div>
                </section>
                <section>
                  <h3 className="text-indigo-400 font-black text-xs uppercase mb-4 tracking-widest">Pauta Principal</h3>
                  <p className="text-sm text-slate-300 leading-relaxed">{ata.agenda}</p>
                </section>
              </div>

              <section>
                <h3 className="text-indigo-400 font-black text-xs uppercase mb-4 tracking-widest">Discussão Detalhada</h3>
                <div className="bg-slate-800/30 p-8 rounded-3xl border border-slate-700 text-slate-300 text-sm leading-8 italic">
                  "{ata.discussion}"
                </div>
              </section>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
                <section className="bg-emerald-500/5 p-6 rounded-3xl border border-emerald-500/10">
                  <h3 className="text-emerald-400 font-black text-xs uppercase mb-4 tracking-widest">Decisões</h3>
                  <p className="text-sm text-slate-300">{ata.decisions}</p>
                </section>
                <section className="bg-orange-500/5 p-6 rounded-3xl border border-orange-500/10">
                  <h3 className="text-orange-400 font-black text-xs uppercase mb-4 tracking-widest">Ações</h3>
                  <ul className="space-y-3">
                    {ata.actionItems.map((item, i) => (
                      <li key={i} className="text-sm text-slate-300 flex items-start gap-3">
                        <span className="text-orange-400 font-bold mt-0.5">•</span> {item}
                      </li>
                    ))}
                  </ul>
                </section>
              </div>
            </div>
          ) : (
            <div className="glass rounded-[2rem] p-12 flex flex-col items-center justify-center flex-grow text-center opacity-40 border-dashed border-4 border-slate-800 bg-transparent">
              <Cloud className="w-20 h-20 mb-6 text-indigo-400" />
              <h2 className="text-2xl font-black text-slate-400 mb-2">Supabase Cloud Ativo</h2>
              <p className="max-w-xs text-sm leading-relaxed">
                Inicie a reunião. Cada frase será salva automaticamente no banco de dados para segurança total dos seus dados.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

createRoot(document.getElementById('root')!).render(<App />);
