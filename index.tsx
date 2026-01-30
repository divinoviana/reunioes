
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
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
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
              sessionPromiseRef.current?.then((session: any) => {
                session.sendRealtimeInput({ media: pcmBlob });
              }).catch((err: any) => console.error("Stream error:", err));
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
            setError("Erro na conexão em tempo real. Verifique se o microfone está funcionando.");
            stopMeeting();
          },
          onclose: () => setIsRecording(false),
        },
        config: {
          responseModalities: [Modality.AUDIO],
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          systemInstruction: 'Você é um assistente profissional de transcrição de reuniões em português do Brasil.',
        }
      });
    } catch (err: any) {
      console.error('Start Meeting Error:', err);
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
      if (audioContextRef.current.state !== 'closed') {
        await audioContextRef.current.close();
      }
      audioContextRef.current = null;
    }
    
    // Add any remaining text
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
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const fullTranscript = transcriptions.map(t => `${t.role === 'user' ? 'Participante' : 'IA'}: ${t.text}`).join('\n');
      
      const prompt = `Gere uma ATA PROFISSIONAL em formato JSON baseada nesta transcrição. Use português formal.
      
      Estrutura:
      {
        "title": "Título da Reunião",
        "date": "${new Date().toLocaleDateString('pt-BR')}",
        "time": "${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}",
        "participants": ["Nomes inferidos"],
        "agenda": "Pauta discutida",
        "discussion": "Resumo detalhado",
        "decisions": "Decisões finais",
        "actionItems": ["Tarefa - Responsável"]
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
      console.error('Generate ATA Error:', err);
      setError("Falha ao gerar a ATA com Inteligência Artificial.");
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
    doc.text(`Data: ${ata.date} | Hora: ${ata.time}`, 20, 40);
    
    doc.setFontSize(14);
    doc.text('Participantes:', 20, 55);
    doc.setFontSize(11);
    doc.text(ata.participants.join(', '), 20, 62);
    
    doc.setFontSize(14);
    doc.text('Discussão:', 20, 75);
    doc.setFontSize(11);
    const discussionLines = doc.splitTextToSize(ata.discussion, 170);
    doc.text(discussionLines, 20, 82);
    
    const yAfterDisc = 82 + (discussionLines.length * 6) + 10;
    doc.setFontSize(14);
    doc.text('Decisões:', 20, yAfterDisc);
    doc.setFontSize(11);
    const decisionLines = doc.splitTextToSize(ata.decisions, 170);
    doc.text(decisionLines, 20, yAfterDisc + 7);

    doc.save(`ATA_${ata.title.replace(/\s+/g, '_')}.pdf`);
  };

  return (
    <div className="min-h-screen bg-[#0f172a] text-slate-100 p-4 md:p-8 max-w-6xl mx-auto flex flex-col gap-6">
      <header className="flex items-center justify-between border-b border-slate-800 pb-6">
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
          <button onClick={exportPDF} className="bg-slate-800 hover:bg-slate-700 px-4 py-2 rounded-lg border border-slate-700 flex items-center gap-2 transition">
            <Download className="w-4 h-4" /> Exportar PDF
          </button>
        )}
      </header>

      {error && (
        <div className="bg-red-500/10 border border-red-500/50 text-red-500 p-4 rounded-xl flex items-center gap-3">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <p className="text-sm font-medium">{error}</p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 flex-grow">
        <div className="lg:col-span-4 flex flex-col gap-6">
          <div className="glass rounded-3xl p-6 flex flex-col items-center gap-6 shadow-2xl">
            <div className="flex flex-col items-center gap-2">
              <span className={`text-5xl font-mono font-bold ${isRecording ? 'text-red-500' : 'text-slate-400'}`}>
                {formatTime(recordingTime)}
              </span>
              <p className="text-xs uppercase tracking-widest text-slate-500 font-bold">Status: {isRecording ? 'Gravando' : 'Inativo'}</p>
            </div>

            <button 
              onClick={isRecording ? stopMeeting : startMeeting}
              className={`w-32 h-32 rounded-full flex items-center justify-center transition-all duration-300 ${
                isRecording ? 'bg-red-500/20 border-4 border-red-500 pulse-recording shadow-[0_0_30px_rgba(239,68,68,0.2)]' : 'bg-indigo-600 hover:bg-indigo-500 shadow-[0_0_30px_rgba(79,70,229,0.3)]'
              }`}
            >
              {isRecording ? <MicOff className="w-12 h-12 text-red-500" /> : <Mic className="w-12 h-12 text-white" />}
            </button>

            <button 
              disabled={isRecording || transcriptions.length === 0 || isGenerating}
              onClick={generateAta}
              className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white py-4 rounded-2xl font-semibold flex items-center justify-center gap-2 transition-all shadow-xl"
            >
              {isGenerating ? <Loader2 className="w-5 h-5 animate-spin" /> : <CheckCircle className="w-5 h-5" />}
              Gerar Ata Profissional
            </button>

            <button 
              onClick={() => { setTranscriptions([]); setAta(null); setRecordingTime(0); }}
              className="w-full bg-slate-800/50 hover:bg-red-500/10 hover:text-red-400 text-slate-400 py-2 rounded-xl text-sm transition-all border border-slate-700"
            >
              <Trash2 className="w-4 h-4 mx-auto" />
            </button>
          </div>

          <div className="glass rounded-3xl p-6 flex-grow flex flex-col gap-4 max-h-[400px]">
            <h3 className="text-sm font-bold text-slate-400 uppercase flex items-center gap-2"><Clock className="w-4 h-4" /> Transcrição</h3>
            <div className="flex-grow overflow-y-auto custom-scrollbar space-y-4 pr-2">
              {transcriptions.length === 0 && !isRecording && (
                <p className="text-center text-slate-600 text-sm mt-10">Transcrição aparecerá aqui durante a gravação.</p>
              )}
              {transcriptions.map((t, i) => (
                <div key={i} className={`flex flex-col ${t.role === 'user' ? 'items-start' : 'items-end'}`}>
                  <div className={`max-w-[90%] rounded-2xl px-4 py-3 text-sm ${t.role === 'user' ? 'bg-slate-800 border border-slate-700' : 'bg-indigo-900/40 border border-indigo-500/30'}`}>
                    {t.text}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="lg:col-span-8 flex flex-col">
          {ata ? (
            <div className="glass rounded-3xl p-8 flex-grow flex flex-col gap-6 overflow-y-auto custom-scrollbar shadow-2xl">
              <div className="border-b border-slate-700 pb-6">
                <h2 className="text-3xl font-bold mb-2">{ata.title}</h2>
                <div className="flex gap-4 text-sm text-slate-400">
                  <span className="flex items-center gap-1.5"><Calendar className="w-4 h-4" /> {ata.date}</span>
                  <span className="flex items-center gap-1.5"><Clock className="w-4 h-4" /> {ata.time}</span>
                </div>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <section>
                  <h3 className="text-indigo-400 font-bold mb-3 flex items-center gap-2"><Users className="w-4 h-4" /> Participantes</h3>
                  <div className="flex flex-wrap gap-2">
                    {ata.participants.map((p, i) => (
                      <span key={i} className="bg-slate-800 px-3 py-1 rounded-full text-xs border border-slate-700">{p}</span>
                    ))}
                  </div>
                </section>
                <section>
                  <h3 className="text-indigo-400 font-bold mb-3 flex items-center gap-2"><Save className="w-4 h-4" /> Pauta</h3>
                  <p className="text-sm text-slate-300">{ata.agenda}</p>
                </section>
              </div>

              <section>
                <h3 className="text-indigo-400 font-bold mb-3">Discussão</h3>
                <div className="bg-slate-800/50 p-6 rounded-2xl border border-slate-700 text-slate-300 text-sm leading-relaxed">
                  {ata.discussion}
                </div>
              </section>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <section>
                  <h3 className="text-green-400 font-bold mb-3 flex items-center gap-2"><CheckCircle className="w-4 h-4" /> Decisões</h3>
                  <div className="bg-green-500/5 p-4 rounded-xl border border-green-500/20 text-sm text-slate-300">
                    {ata.decisions}
                  </div>
                </section>
                <section>
                  <h3 className="text-orange-400 font-bold mb-3 flex items-center gap-2"><FileText className="w-4 h-4" /> Ações</h3>
                  <ul className="space-y-2">
                    {ata.actionItems.map((item, i) => (
                      <li key={i} className="bg-slate-800/40 p-3 rounded-lg border border-slate-700 text-sm flex gap-3">
                        <span className="text-orange-400 font-bold">•</span> {item}
                      </li>
                    ))}
                  </ul>
                </section>
              </div>
            </div>
          ) : (
            <div className="glass rounded-3xl p-12 flex flex-col items-center justify-center flex-grow text-center text-slate-500 border-dashed border-2 border-slate-800">
              <Mic className="w-16 h-16 opacity-10 mb-4" />
              <h2 className="text-xl font-bold text-slate-400">Aguardando Gravação</h2>
              <p className="max-w-xs mx-auto mt-2 text-sm leading-relaxed">
                Inicie o microfone, conduza sua reunião e clique em "Gerar Ata" para ver a mágica acontecer.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

createRoot(document.getElementById('root')!).render(<App />);
