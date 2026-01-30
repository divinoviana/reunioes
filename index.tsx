
import React, { useState, useRef, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { GoogleGenAI, Modality, LiveServerMessage } from '@google/genai';
import { Mic, MicOff, FileText, Download, Trash2, Clock, Users, Calendar, CheckCircle, Save, Loader2, AlertCircle } from 'lucide-react';

// Polyfill minimal para process.env em ambientes sem bundler
if (typeof (window as any).process === 'undefined') {
  (window as any).process = { env: {} };
}

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
  rawText: string;
}

// --- Utils for Audio Encoding/Decoding ---
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
  
  const sessionPromiseRef = useRef<Promise<any> | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);
  const currentTranscriptionRef = useRef({ user: '', model: '' });

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
      const apiKey = (window as any).process?.env?.API_KEY;
      if (!apiKey) {
        throw new Error("Chave de API não configurada no ambiente.");
      }

      const ai = new GoogleGenAI({ apiKey });
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      streamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true });

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
              sessionPromiseRef.current?.then((session) => {
                session.sendRealtimeInput({ media: pcmBlob });
              }).catch(err => console.error("Falha ao enviar áudio:", err));
            };
            
            source.connect(scriptProcessor);
            scriptProcessor.connect(audioContextRef.current.destination);
          },
          onmessage: async (message: LiveServerMessage) => {
            if (message.serverContent?.inputTranscription) {
              const text = message.serverContent.inputTranscription.text;
              currentTranscriptionRef.current.user += text;
            } else if (message.serverContent?.outputTranscription) {
              const text = message.serverContent.outputTranscription.text;
              currentTranscriptionRef.current.model += text;
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
            setError("Erro na conexão em tempo real. Verifique sua chave de API.");
            stopMeeting();
          },
          onclose: () => setIsRecording(false),
        },
        config: {
          responseModalities: [Modality.AUDIO],
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          systemInstruction: 'Você é um assistente de transcrição de reuniões em português do Brasil. Transcreva fielmente as falas dos participantes.',
        }
      });
    } catch (err: any) {
      console.error('Failed to start meeting:', err);
      setError(err.message || "Não foi possível iniciar o microfone ou a conexão.");
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
      if (audioContextRef.current.state !== 'closed') {
        await audioContextRef.current.close();
      }
      audioContextRef.current = null;
    }
    
    // Captura o que restou na transcrição atual
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
      const apiKey = (window as any).process?.env?.API_KEY;
      const ai = new GoogleGenAI({ apiKey });
      const fullTranscript = transcriptions.map(t => `${t.role === 'user' ? 'Participante' : 'IA'}: ${t.text}`).join('\n');
      
      const prompt = `Com base na seguinte transcrição de reunião, gere uma ATA PROFISSIONAL E FORMAL em formato JSON. 
      A reunião ocorreu hoje (${new Date().toLocaleDateString('pt-BR')}).
      
      Estrutura JSON:
      {
        "title": "Título",
        "date": "Data",
        "time": "Horário",
        "participants": ["Nomes"],
        "agenda": "Pauta",
        "discussion": "Resumo detalhado",
        "decisions": "Decisões",
        "actionItems": ["Ação - Responsável"]
      }
      
      Transcrição:
      ${fullTranscript}`;

      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: prompt,
        config: { responseMimeType: 'application/json' }
      });

      const result = JSON.parse(response.text || '{}');
      setAta({ ...result, rawText: fullTranscript });
    } catch (err) {
      console.error('Erro ao gerar ATA:', err);
      setError("Falha ao processar a ATA com a inteligência artificial.");
    } finally {
      setIsGenerating(false);
    }
  };

  const exportPDF = () => {
    if (!ata) return;
    const { jsPDF } = (window as any).jspdf;
    const doc = new jsPDF();
    doc.setFontSize(22);
    doc.text(ata.title, 20, 30);
    doc.setFontSize(12);
    doc.text(`Data: ${ata.date} | Horário: ${ata.time}`, 20, 40);
    doc.save(`ATA_${ata.title.replace(/\s+/g, '_')}.pdf`);
  };

  return (
    <div className="min-h-screen p-4 md:p-8 max-w-6xl mx-auto flex flex-col gap-6">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="bg-indigo-600 p-2 rounded-xl shadow-lg">
            <FileText className="w-8 h-8 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">MinuteMaster <span className="text-indigo-400">AI</span></h1>
            <p className="text-slate-400 text-sm">Gerador de ATA Profissional</p>
          </div>
        </div>
        {ata && (
          <button onClick={exportPDF} className="bg-slate-800 hover:bg-slate-700 px-4 py-2 rounded-lg border border-slate-700 flex items-center gap-2">
            <Download className="w-4 h-4" /> PDF
          </button>
        )}
      </header>

      {error && (
        <div className="bg-red-500/10 border border-red-500/50 text-red-500 p-4 rounded-xl flex items-center gap-3 animate-in fade-in zoom-in">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <p className="text-sm font-medium">{error}</p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 flex-grow">
        <div className="lg:col-span-4 flex flex-col gap-6">
          <div className="glass rounded-3xl p-6 flex flex-col items-center gap-6 shadow-2xl relative">
            <div className="flex flex-col items-center gap-2">
              <span className={`text-5xl font-mono font-bold ${isRecording ? 'text-red-500' : 'text-slate-400'}`}>
                {formatTime(recordingTime)}
              </span>
              <p className="text-xs uppercase tracking-widest text-slate-500">Gravando...</p>
            </div>

            <button 
              onClick={isRecording ? stopMeeting : startMeeting}
              className={`w-32 h-32 rounded-full flex items-center justify-center transition-all ${
                isRecording ? 'bg-red-500/20 border-4 border-red-500 pulse-recording' : 'bg-indigo-600 hover:bg-indigo-500'
              }`}
            >
              {isRecording ? <MicOff className="w-12 h-12 text-red-500" /> : <Mic className="w-12 h-12 text-white" />}
            </button>

            <button 
              disabled={isRecording || transcriptions.length === 0 || isGenerating}
              onClick={generateAta}
              className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white py-4 rounded-2xl font-semibold flex items-center justify-center gap-2"
            >
              {isGenerating ? <Loader2 className="w-5 h-5 animate-spin" /> : <CheckCircle className="w-5 h-5" />}
              Gerar Ata Profissional
            </button>
          </div>

          <div className="glass rounded-3xl p-6 flex-grow flex flex-col gap-4 max-h-[400px]">
            <h3 className="text-sm font-bold text-slate-400 uppercase flex items-center gap-2"><Clock className="w-4 h-4" /> Transcrição</h3>
            <div className="flex-grow overflow-y-auto pr-2 space-y-4">
              {transcriptions.map((t, i) => (
                <div key={i} className={`flex flex-col ${t.role === 'user' ? 'items-start' : 'items-end'}`}>
                  <div className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm ${t.role === 'user' ? 'bg-slate-800' : 'bg-indigo-900/30 border border-indigo-500/30'}`}>
                    {t.text}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="lg:col-span-8 flex flex-col">
          {ata ? (
            <div className="glass rounded-3xl p-8 flex-grow flex flex-col gap-6 overflow-y-auto max-h-[800px]">
              <h2 className="text-3xl font-bold">{ata.title}</h2>
              <div className="grid grid-cols-2 gap-4 text-sm text-slate-400">
                <span className="flex items-center gap-2"><Calendar className="w-4 h-4" /> {ata.date}</span>
                <span className="flex items-center gap-2"><Clock className="w-4 h-4" /> {ata.time}</span>
              </div>
              <section>
                <h3 className="text-indigo-400 font-bold mb-2">Pauta e Discussão</h3>
                <div className="bg-slate-800/50 p-4 rounded-xl border border-slate-700 text-slate-300 leading-relaxed">
                  {ata.discussion}
                </div>
              </section>
              <section>
                <h3 className="text-green-400 font-bold mb-2">Decisões</h3>
                <div className="bg-green-500/5 p-4 rounded-xl border border-green-500/20 text-slate-300">
                  {ata.decisions}
                </div>
              </section>
              <section>
                <h3 className="text-orange-400 font-bold mb-2">Ações</h3>
                <ul className="space-y-2">
                  {ata.actionItems.map((item, i) => (
                    <li key={i} className="flex gap-3 bg-slate-800/30 p-3 rounded-lg border border-slate-700">
                      <span className="text-orange-400 font-bold">•</span> {item}
                    </li>
                  ))}
                </ul>
              </section>
            </div>
          ) : (
            <div className="glass rounded-3xl p-12 flex flex-col items-center justify-center flex-grow text-center text-slate-500">
              <Mic className="w-16 h-16 opacity-20 mb-4" />
              <h2 className="text-xl font-bold text-slate-300">Aguardando Gravação</h2>
              <p className="max-w-xs mx-auto mt-2">Clique no microfone para começar a ouvir a reunião e gerar o documento.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

createRoot(document.getElementById('root')!).render(<App />);
