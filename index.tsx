
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

  const saveToSupabase = async (entry: TranscriptionEntry) => {
    if (!meetingIdRef.current) return;
    await supabase.from('transcriptions').insert([{
      meeting_id: meetingIdRef.current,
      role: entry.role,
      text: entry.text,
      timestamp: entry.timestamp.toISOString()
    }]);
  };

  const startMeeting = async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

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
                saveToSupabase(entry);
              }
              if (mText) {
                const entry: TranscriptionEntry = { role: 'model', text: mText, timestamp: new Date() };
                setTranscriptions(prev => [...prev, entry]);
                saveToSupabase(entry);
              }
              currentTranscriptionRef.current = { user: '', model: '' };
            }
          },
          onerror: (e) => {
            console.error(e);
            setError("Erro na conexão Gemini. Verifique sua API_KEY no Vercel.");
            stopMeeting();
          }
        },
        config: {
          responseModalities: [Modality.AUDIO],
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          systemInstruction: 'Você é um assistente profissional de transcrição.',
        }
      });
    } catch (err: any) {
      setError("Erro ao acessar microfone ou conectar ao Gemini.");
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
      await audioContextRef.current.close();
      audioContextRef.current = null;
    }
  };

  const generateAta = async () => {
    if (transcriptions.length === 0) return;
    setIsGenerating(true);
    setIsSaving(true);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const fullTranscript = transcriptions.map(t => `${t.role}: ${t.text}`).join('\n');
      
      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: `Crie uma ATA profissional em JSON para: ${fullTranscript}`,
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

      await supabase.from('meetings').insert([{
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
    } catch (err) {
      setError("Falha ao gerar ou salvar ATA.");
    } finally {
      setIsGenerating(false);
      setIsSaving(false);
    }
  };

  const exportPDF = () => {
    if (!ata) return;
    const { jsPDF } = (window as any).jspdf;
    const doc = new jsPDF();
    doc.setFontSize(22);
    doc.text(ata.title, 20, 25);
    doc.setFontSize(10);
    doc.text(`ID: ${meetingIdRef.current?.slice(0, 8)} | ${ata.date}`, 20, 32);
    doc.line(20, 35, 190, 35);
    doc.setFontSize(12);
    doc.text(`Participantes: ${ata.participants.join(', ')}`, 20, 50);
    const discLines = doc.splitTextToSize(`Resumo: ${ata.discussion}`, 170);
    doc.text(discLines, 20, 65);
    doc.save(`ATA_${ata.title}.pdf`);
  };

  return (
    <div className="min-h-screen bg-[#0f172a] text-slate-100 p-6 max-w-6xl mx-auto flex flex-col gap-6 font-inter">
      <header className="flex justify-between items-center border-b border-slate-800 pb-6">
        <div className="flex items-center gap-3">
          <div className="bg-indigo-600 p-2 rounded-xl">
            <FileText className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold">MinuteMaster <span className="text-indigo-400">AI</span></h1>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 text-emerald-400 text-xs bg-emerald-500/10 px-3 py-1.5 rounded-full border border-emerald-500/20">
            <Cloud className="w-3 h-3" />
            <span>Supabase Ativo</span>
          </div>
          {ata && (
            <button onClick={exportPDF} className="bg-indigo-600 hover:bg-indigo-500 px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2 transition-all">
              <Download className="w-4 h-4" /> PDF
            </button>
          )}
        </div>
      </header>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-400 p-4 rounded-xl flex items-center gap-3 animate-in fade-in">
          <AlertCircle className="w-5 h-5" />
          <p className="text-sm font-medium">{error}</p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 flex-grow">
        <div className="lg:col-span-4 flex flex-col gap-6">
          <div className="glass rounded-[2rem] p-8 flex flex-col items-center gap-8 shadow-2xl border border-white/5">
            <div className="flex flex-col items-center gap-1">
              <span className={`text-6xl font-mono font-bold tracking-tighter ${isRecording ? 'text-red-500' : 'text-slate-500'}`}>
                {formatTime(recordingTime)}
              </span>
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">{isRecording ? 'Capturando Voz' : 'Aguardando'}</p>
            </div>

            <button 
              onClick={isRecording ? stopMeeting : startMeeting}
              className={`w-36 h-36 rounded-full flex items-center justify-center transition-all duration-500 ${
                isRecording ? 'bg-red-500/20 border-4 border-red-500' : 'bg-indigo-600 shadow-[0_0_30px_rgba(79,70,229,0.3)]'
              }`}
            >
              {isRecording ? <MicOff className="w-14 h-14 text-red-500" /> : <Mic className="w-14 h-14 text-white" />}
            </button>

            <div className="w-full flex flex-col gap-3">
              <button 
                disabled={isRecording || transcriptions.length === 0 || isGenerating}
                onClick={generateAta}
                className="w-full bg-slate-100 hover:bg-white disabled:opacity-30 text-slate-900 py-4 rounded-2xl font-bold flex items-center justify-center gap-2 transition-all"
              >
                {isGenerating || isSaving ? <Loader2 className="w-5 h-5 animate-spin" /> : <CheckCircle className="w-5 h-5" />}
                Gerar ATA Profissional
              </button>
              <button onClick={() => window.location.reload()} className="text-[10px] text-slate-500 uppercase font-bold hover:text-slate-300">Nova Reunião</button>
            </div>
          </div>

          <div className="glass rounded-[2rem] p-6 flex-grow flex flex-col gap-4 max-h-[300px] border border-white/5">
            <h3 className="text-[10px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-2">
              <Clock className="w-4 h-4" /> Transcrição Live
            </h3>
            <div className="flex-grow overflow-y-auto custom-scrollbar space-y-3">
              {transcriptions.map((t, i) => (
                <div key={i} className={`p-3 rounded-xl text-xs leading-relaxed ${t.role === 'user' ? 'bg-slate-800/50' : 'bg-indigo-900/20 text-indigo-200'}`}>
                  {t.text}
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="lg:col-span-8">
          {ata ? (
            <div className="glass rounded-[2rem] p-10 flex flex-col gap-8 shadow-2xl border border-white/5 animate-in slide-in-from-right">
              <div className="space-y-2">
                <h2 className="text-3xl font-black">{ata.title}</h2>
                <div className="flex gap-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                  <span className="flex items-center gap-1"><Calendar className="w-3 h-3" /> {ata.date}</span>
                  <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> {ata.time}</span>
                </div>
              </div>
              
              <div className="grid grid-cols-2 gap-8">
                <section>
                  <h4 className="text-indigo-400 text-[10px] font-black uppercase mb-3">Participantes</h4>
                  <div className="flex flex-wrap gap-2">
                    {ata.participants.map((p, i) => (
                      <span key={i} className="bg-slate-800 px-3 py-1.5 rounded-lg text-xs font-medium border border-slate-700">{p}</span>
                    ))}
                  </div>
                </section>
                <section>
                  <h4 className="text-indigo-400 text-[10px] font-black uppercase mb-3">Pauta</h4>
                  <p className="text-sm text-slate-300">{ata.agenda}</p>
                </section>
              </div>

              <section className="bg-slate-800/30 p-6 rounded-2xl border border-slate-700/50">
                <h4 className="text-indigo-400 text-[10px] font-black uppercase mb-3">Resumo Executivo</h4>
                <p className="text-sm text-slate-300 leading-relaxed italic">"{ata.discussion}"</p>
              </section>

              <div className="grid grid-cols-2 gap-8">
                <section className="bg-emerald-500/5 p-5 rounded-2xl border border-emerald-500/10">
                  <h4 className="text-emerald-400 text-[10px] font-black uppercase mb-3">Decisões</h4>
                  <p className="text-sm text-slate-300">{ata.decisions}</p>
                </section>
                <section className="bg-orange-500/5 p-5 rounded-2xl border border-orange-500/10">
                  <h4 className="text-orange-400 text-[10px] font-black uppercase mb-3">Próximos Passos</h4>
                  <ul className="space-y-2">
                    {ata.actionItems.map((item, i) => (
                      <li key={i} className="text-sm text-slate-300 flex items-start gap-2">• {item}</li>
                    ))}
                  </ul>
                </section>
              </div>
            </div>
          ) : (
            <div className="glass rounded-[2rem] p-12 flex flex-col items-center justify-center h-full text-center opacity-40 border-dashed border-2 border-slate-700">
              <Cloud className="w-16 h-16 mb-4 text-indigo-400" />
              <h2 className="text-xl font-bold mb-2">Pronto para Sincronizar</h2>
              <p className="max-w-xs text-xs">As transcrições aparecerão aqui em tempo real e serão salvas no seu banco Supabase.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

createRoot(document.getElementById('root')!).render(<App />);
