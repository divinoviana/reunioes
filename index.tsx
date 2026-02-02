
import React, { useState, useRef, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { GoogleGenAI, Modality, LiveServerMessage } from '@google/genai';
import { createClient, User } from '@supabase/supabase-js';
import { 
  Mic, MicOff, FileText, Download, Trash2, Clock, Users, 
  Calendar, CheckCircle, Save, Loader2, AlertCircle, 
  Cloud, Edit3, RefreshCcw, Type, ChevronRight, LogIn, 
  UserPlus, LogOut, LayoutDashboard, Settings, Sparkles, 
  Camera, Upload, Video, MessageSquare, History, ShieldAlert,
  Search, Key, UserX, ExternalLink
} from 'lucide-react';

// Supabase Configuration
const SUPABASE_URL = 'https://wuvmwcspalapvxbqunnp.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_TE26qMOqYhJJ3xyLklAcLA_X0WCP1r3';
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// --- Helpers ---
function encode(bytes: Uint8Array) {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// --- Types ---
type View = 'auth' | 'dashboard' | 'studio' | 'corrector' | 'profile' | 'admin';

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
  user_id?: string;
}

interface Profile {
  id: string;
  full_name: string;
  phone: string;
  avatar_url: string;
  role: 'user' | 'admin';
  email?: string;
}

const App: React.FC = () => {
  const [currentView, setCurrentView] = useState<View>('auth');
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [transcriptions, setTranscriptions] = useState<TranscriptionEntry[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [ata, setAta] = useState<AtaData | null>(null);
  const [meetingTitle, setMeetingTitle] = useState('');
  const [recordingTime, setRecordingTime] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [pastMeetings, setPastMeetings] = useState<AtaData[]>([]);
  const [allUsers, setAllUsers] = useState<Profile[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isAdminLoading, setIsAdminLoading] = useState(false);
  const [textToCorrect, setTextToCorrect] = useState('');
  const [correctedText, setCorrectedText] = useState('');
  const [isCorrecting, setIsCorrecting] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [isRegistering, setIsRegistering] = useState(false);
  const [authLoading, setAuthLoading] = useState(false);

  const sessionPromiseRef = useRef<any>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);
  const transcriptionBufferRef = useRef('');
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        setUser(session.user);
        fetchProfile(session.user.id);
        setCurrentView('dashboard');
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      if (session) {
        fetchProfile(session.user.id);
        setCurrentView('dashboard');
      } else {
        setProfile(null);
        setCurrentView('auth');
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const fetchProfile = async (userId: string) => {
    try {
      const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).single();
      if (error) throw error;
      if (data) {
        setProfile(data);
        if (data.role === 'admin') fetchAllUsers();
      }
      fetchMeetings(userId);
    } catch (err) {
      console.error("Error fetching profile:", err);
    }
  };

  const fetchMeetings = async (userId: string) => {
    const { data } = await supabase.from('meetings').select('*').order('created_at', { ascending: false });
    if (data) setPastMeetings(data as any);
  };

  const fetchAllUsers = async () => {
    setIsAdminLoading(true);
    const { data, error } = await supabase.from('profiles').select('*');
    if (!error && data) setAllUsers(data);
    setIsAdminLoading(false);
  };

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setAuthLoading(true);
    try {
      if (isRegistering) {
        const { error: signUpError } = await supabase.auth.signUp({ 
          email, 
          password,
          options: {
            data: { full_name: fullName || 'Novo Usuário' }
          }
        });
        if (signUpError) throw signUpError;
        alert("Cadastro realizado! Verifique seu e-mail para confirmar a conta.");
        setIsRegistering(false);
      } else {
        const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
        if (signInError) throw signInError;
      }
    } catch (err: any) {
      setError(err.message || "Ocorreu um erro na autenticação.");
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
  };

  // --- Real-time Recording Logic ---
  useEffect(() => {
    if (isRecording) {
      timerRef.current = window.setInterval(() => setRecordingTime(prev => prev + 1), 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [isRecording]);

  const startMeeting = async () => {
    if (!meetingTitle) { setError("Por favor, defina um título para a reunião."); return; }
    setError(null);
    setTranscriptions([]);
    setAta(null);
    
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      audioContextRef.current = new AudioContext({ sampleRate: 16000 });
      
      setIsRecording(true);
      setRecordingTime(0);

      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        callbacks: {
          onopen: () => {
            const source = audioContextRef.current!.createMediaStreamSource(stream);
            const scriptProcessor = audioContextRef.current!.createScriptProcessor(4096, 1, 1);
            
            scriptProcessor.onaudioprocess = (e) => {
              if (!isRecording) return;
              const inputData = e.inputBuffer.getChannelData(0);
              const int16 = new Int16Array(inputData.length);
              for (let i = 0; i < inputData.length; i++) {
                int16[i] = inputData[i] * 32768;
              }
              const pcmData = new Uint8Array(int16.buffer);
              const base64 = encode(pcmData);
              
              sessionPromise.then((session) => {
                session.sendRealtimeInput({
                  media: { data: base64, mimeType: 'audio/pcm;rate=16000' }
                });
              });
            };
            
            source.connect(scriptProcessor);
            scriptProcessor.connect(audioContextRef.current!.destination);
          },
          onmessage: (msg: LiveServerMessage) => {
            if (msg.serverContent?.inputTranscription) {
              transcriptionBufferRef.current += msg.serverContent.inputTranscription.text;
            }
            if (msg.serverContent?.turnComplete) {
              const text = transcriptionBufferRef.current.trim();
              if (text) {
                setTranscriptions(prev => [...prev, { 
                  role: 'user', 
                  text, 
                  timestamp: new Date() 
                }]);
              }
              transcriptionBufferRef.current = '';
            }
          },
          onerror: (err) => {
            console.error("Live API Error:", err);
            setError("Ocorreu um erro na conexão de áudio.");
            stopMeeting();
          },
          onclose: () => {
            setIsRecording(false);
          }
        },
        config: { 
          responseModalities: [Modality.AUDIO], 
          inputAudioTranscription: {} 
        }
      });
      
      sessionPromiseRef.current = sessionPromise;
      
    } catch (err) {
      console.error("Mic Access Error:", err);
      setError("Não foi possível acessar seu microfone.");
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

    if (sessionPromiseRef.current) {
      const session = await sessionPromiseRef.current;
      session.close();
      sessionPromiseRef.current = null;
    }
  };

  const generateAta = async () => {
    if (transcriptions.length === 0) {
      setError("Nenhuma fala foi capturada para gerar a ATA.");
      return;
    }
    
    setIsGenerating(true);
    setError(null);
    
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const transcript = transcriptions.map(t => `${t.role === 'user' ? 'Participante' : 'IA'}: ${t.text}`).join('\n');
      
      const res = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: `Gere uma ATA profissional de reunião baseada na seguinte transcrição para o título "${meetingTitle}". 
        O formato deve ser um JSON rigoroso com as propriedades: title, date, time, participants (array), agenda, discussion, decisions, actionItems (array).
        
        Transcrição:
        ${transcript}`,
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
      
      const data = JSON.parse(res.text || '{}');
      setAta(data);
      
      if (user) {
        await supabase.from('meetings').insert([{ 
          ...data, 
          user_id: user.id, 
          action_items: data.actionItems,
          created_at: new Date().toISOString()
        }]);
        fetchMeetings(user.id);
      }
    } catch (err) {
      console.error("Ata Generation Error:", err);
      setError("Erro ao processar a ATA profissional. Tente novamente.");
    } finally {
      setIsGenerating(false);
    }
  };

  const downloadPDF = () => {
    if (!ata) return;
    
    const { jsPDF } = (window as any).jspdf;
    const doc = new jsPDF();
    const margin = 20;
    let y = 30;

    // Header
    doc.setFontSize(22);
    doc.setFont("helvetica", "bold");
    doc.text("ATA DE REUNIÃO", 105, y, { align: "center" });
    
    y += 15;
    doc.setFontSize(14);
    doc.text(ata.title.toUpperCase(), 105, y, { align: "center" });
    
    y += 20;
    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.text(`Data: ${ata.date}`, margin, y);
    doc.text(`Hora: ${ata.time}`, 150, y);
    
    y += 10;
    doc.setFont("helvetica", "bold");
    doc.text("Participantes:", margin, y);
    doc.setFont("helvetica", "normal");
    doc.text(ata.participants.join(", "), margin + 30, y, { maxWidth: 140 });
    
    y += 15;
    doc.setFont("helvetica", "bold");
    doc.text("Pauta:", margin, y);
    y += 7;
    doc.setFont("helvetica", "normal");
    doc.text(ata.agenda, margin, y, { maxWidth: 170 });
    
    y += doc.splitTextToSize(ata.agenda, 170).length * 5 + 10;
    doc.setFont("helvetica", "bold");
    doc.text("Discussão:", margin, y);
    y += 7;
    doc.setFont("helvetica", "normal");
    doc.text(ata.discussion, margin, y, { maxWidth: 170 });
    
    y += doc.splitTextToSize(ata.discussion, 170).length * 5 + 10;
    doc.setFont("helvetica", "bold");
    doc.text("Decisões:", margin, y);
    y += 7;
    doc.setFont("helvetica", "normal");
    doc.text(ata.decisions, margin, y, { maxWidth: 170 });
    
    y += doc.splitTextToSize(ata.decisions, 170).length * 5 + 10;
    doc.setFont("helvetica", "bold");
    doc.text("Ações / Pendências:", margin, y);
    y += 7;
    doc.setFont("helvetica", "normal");
    ata.actionItems.forEach((item, i) => {
      doc.text(`• ${item}`, margin + 5, y);
      y += 7;
    });

    doc.save(`ATA_${ata.title.replace(/\s+/g, '_')}.pdf`);
  };

  const correctText = async () => {
    if (!textToCorrect) return;
    setIsCorrecting(true);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const res = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: `Corrija e melhore profissionalmente o seguinte texto, mantendo o tom mas eliminando erros:\n\n${textToCorrect}`,
      });
      setCorrectedText(res.text || '');
    } catch (err) { setError("Erro na correção."); }
    finally { setIsCorrecting(false); }
  };

  const formatSecs = (s: number) => `${Math.floor(s/60).toString().padStart(2,'0')}:${(s%60).toString().padStart(2,'0')}`;

  if (currentView === 'auth') {
    return (
      <div className="min-h-screen bg-[#0b0f1a] flex items-center justify-center p-6">
        <div className="max-w-md w-full glass rounded-[2.5rem] p-10 border border-white/5 shadow-2xl space-y-8 animate-in fade-in zoom-in">
          <div className="text-center space-y-2">
            <div className="bg-indigo-600 w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <FileText className="text-white w-8 h-8" />
            </div>
            <h1 className="text-3xl font-black text-white">MinuteMaster <span className="text-indigo-400">Pro</span></h1>
            <p className="text-slate-500 text-sm">IA para Reuniões de Alta Performance</p>
          </div>
          
          <form onSubmit={handleAuth} className="space-y-4">
            {isRegistering && (
              <input type="text" placeholder="Nome Completo" value={fullName} onChange={e => setFullName(e.target.value)} className="w-full bg-slate-900 border border-slate-800 rounded-xl px-4 py-3 text-white outline-none focus:border-indigo-500 transition-all" required />
            )}
            <input type="email" placeholder="E-mail" value={email} onChange={e => setEmail(e.target.value)} className="w-full bg-slate-900 border border-slate-800 rounded-xl px-4 py-3 text-white outline-none focus:border-indigo-500 transition-all" required />
            <input type="password" placeholder="Senha" value={password} onChange={e => setPassword(e.target.value)} className="w-full bg-slate-900 border border-slate-800 rounded-xl px-4 py-3 text-white outline-none focus:border-indigo-500 transition-all" required />
            
            {error && (
              <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-3 rounded-xl text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 flex-shrink-0" /> {error}
              </div>
            )}

            <button type="submit" disabled={authLoading} className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-black py-3 rounded-xl transition-all flex items-center justify-center gap-2">
              {authLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : (isRegistering ? 'Criar Conta' : 'Entrar')}
            </button>
          </form>

          <div className="text-center">
            <button onClick={() => { setIsRegistering(!isRegistering); setError(null); }} className="text-indigo-400 text-xs font-bold uppercase hover:text-white transition-colors">
              {isRegistering ? 'Já tem conta? Entrar' : 'Novo por aqui? Cadastre-se'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0b0f1a] text-slate-100 flex font-inter">
      <aside className="w-20 md:w-64 border-r border-slate-800/50 glass flex flex-col p-4 md:p-6 gap-8 z-50">
        <div className="flex items-center gap-3 px-2">
          <div className="bg-indigo-600 p-2 rounded-lg"><Sparkles className="w-5 h-5 text-white" /></div>
          <span className="hidden md:block font-black text-lg">MM Pro</span>
        </div>
        <nav className="flex flex-col gap-2">
          {[
            { id: 'dashboard', icon: LayoutDashboard, label: 'Dashboard' },
            { id: 'studio', icon: Mic, label: 'Estúdio de ATA' },
            { id: 'corrector', icon: Edit3, label: 'Corretor Pro' },
            { id: 'profile', icon: Settings, label: 'Perfil' },
            ...(profile?.role === 'admin' ? [{ id: 'admin', icon: ShieldAlert, label: 'Admin' }] : []),
          ].map(item => (
            <button key={item.id} onClick={() => setCurrentView(item.id as View)} className={`flex items-center gap-4 p-3 rounded-xl transition-all ${currentView === item.id ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/20' : 'text-slate-500 hover:bg-slate-800/50'}`}>
              <item.icon className="w-5 h-5" /><span className="hidden md:block font-bold text-sm">{item.label}</span>
            </button>
          ))}
        </nav>
        <div className="mt-auto pt-6 border-t border-slate-800">
          <button onClick={handleLogout} className="flex items-center gap-4 p-3 rounded-xl text-red-400 hover:bg-red-400/10 w-full transition-all">
            <LogOut className="w-5 h-5" /><span className="hidden md:block font-bold text-sm">Sair</span>
          </button>
        </div>
      </aside>

      <main className="flex-grow p-4 md:p-10 overflow-y-auto custom-scrollbar">
        {currentView === 'dashboard' && (
          <div className="max-w-5xl mx-auto space-y-10 animate-in fade-in">
            <h2 className="text-3xl font-black">Olá, {profile?.full_name?.split(' ')[0]}!</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="glass p-6 rounded-3xl border border-white/5 space-y-4">
                <History className="w-8 h-8 text-indigo-400" />
                <div>
                  <p className="text-3xl font-black">{pastMeetings.length}</p>
                  <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Minhas ATAs</p>
                </div>
              </div>
            </div>
            <section className="space-y-4">
              <h3 className="text-xs font-black text-slate-500 uppercase tracking-widest">Atividades Recentes</h3>
              {pastMeetings.length === 0 ? (
                <div className="p-10 text-center border border-dashed border-slate-800 rounded-3xl opacity-30">Nenhuma reunião salva ainda.</div>
              ) : (
                pastMeetings.map((m, i) => (
                  <div key={i} className="glass p-5 rounded-2xl border border-white/5 flex justify-between items-center group hover:border-indigo-500/30 transition-all">
                    <div className="flex items-center gap-4">
                      <div className="bg-slate-900 p-3 rounded-xl"><FileText className="text-indigo-400 w-5 h-5" /></div>
                      <div><h4 className="font-bold">{m.title}</h4><p className="text-[10px] text-slate-500 uppercase">{m.date} • {m.participants?.length || 0} part.</p></div>
                    </div>
                    <button onClick={() => { setAta(m); setCurrentView('studio'); }} className="bg-slate-800 hover:bg-slate-700 px-4 py-2 rounded-lg text-xs font-bold transition-all">Ver Detalhes</button>
                  </div>
                ))
              )}
            </section>
          </div>
        )}

        {currentView === 'studio' && (
          <div className="max-w-5xl mx-auto space-y-8 animate-in fade-in">
            <h2 className="text-2xl font-black flex items-center gap-3">Estúdio de Captura <div className={`w-2 h-2 rounded-full ${isRecording ? 'bg-red-500 animate-pulse' : 'bg-slate-800'}`}></div></h2>
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
              <div className="lg:col-span-4 glass rounded-[2.5rem] p-10 flex flex-col items-center gap-8 shadow-2xl border border-white/5">
                <div className="w-full space-y-2">
                   <label className="text-[10px] font-black uppercase text-slate-500">Pauta Principal</label>
                   <input placeholder="Título da Reunião" value={meetingTitle} onChange={e => setMeetingTitle(e.target.value)} className="w-full bg-slate-900 border border-slate-800 rounded-xl px-4 py-3 text-white outline-none focus:border-indigo-500 transition-all" />
                </div>
                
                <div className="flex flex-col items-center">
                   <span className={`text-6xl font-mono font-black tracking-tighter ${isRecording ? 'text-red-500' : 'text-slate-700'}`}>{formatSecs(recordingTime)}</span>
                   <p className="text-[10px] font-black uppercase text-slate-500 mt-2">{isRecording ? 'Capturando áudio...' : 'Microfone em espera'}</p>
                </div>

                <button 
                  onClick={isRecording ? stopMeeting : startMeeting} 
                  className={`relative w-32 h-32 rounded-full flex items-center justify-center transition-all ${isRecording ? 'bg-red-500/20 border-4 border-red-500 shadow-[0_0_50px_rgba(239,68,68,0.3)]' : 'bg-indigo-600 shadow-xl shadow-indigo-600/30'}`}
                >
                   {isRecording ? <MicOff className="w-12 h-12 text-red-500" /> : <Mic className="w-12 h-12 text-white" />}
                   {isRecording && <div className="absolute inset-0 rounded-full border border-red-500 animate-ping opacity-20"></div>}
                </button>

                <button 
                  disabled={isRecording || (transcriptions.length === 0 && !ata)} 
                  onClick={generateAta} 
                  className="w-full bg-white text-slate-950 font-black py-4 rounded-xl disabled:opacity-20 flex items-center justify-center gap-2 hover:bg-slate-200 transition-all"
                >
                   {isGenerating ? <Loader2 className="w-5 h-5 animate-spin" /> : <Sparkles className="w-5 h-5" />} 
                   Gerar ATA Profissional
                </button>
                
                {error && <div className="text-[10px] text-red-400 font-bold uppercase text-center">{error}</div>}
              </div>

              <div className="lg:col-span-8 glass rounded-[2.5rem] p-8 border border-white/5 min-h-[500px] flex flex-col">
                {ata ? (
                  <div className="space-y-6 animate-in slide-in-from-right-4">
                    <div className="flex justify-between items-start">
                       <div>
                          <h3 className="text-2xl font-black">{ata.title}</h3>
                          <p className="text-xs text-slate-500 uppercase">{ata.date} • {ata.time}</p>
                       </div>
                       <div className="flex gap-2">
                          <button onClick={downloadPDF} className="bg-indigo-600 hover:bg-indigo-500 p-2.5 rounded-xl transition-all"><Download className="w-5 h-5 text-white" /></button>
                          <button onClick={() => setAta(null)} className="bg-slate-800 hover:bg-slate-700 p-2.5 rounded-xl transition-all"><RefreshCcw className="w-5 h-5 text-slate-400" /></button>
                       </div>
                    </div>
                    
                    <div className="space-y-4">
                       <div className="p-5 bg-slate-900/50 rounded-2xl border border-white/5"><h4 className="text-[10px] font-black uppercase text-indigo-400 mb-2">Discussão Principal</h4><p className="text-sm text-slate-300 leading-relaxed italic">"{ata.discussion}"</p></div>
                       
                       <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div className="p-5 bg-emerald-500/5 rounded-2xl border border-emerald-500/10"><h4 className="text-[10px] font-black uppercase text-emerald-400 mb-2">Decisões Tomadas</h4><p className="text-xs text-slate-300">{ata.decisions}</p></div>
                          <div className="p-5 bg-orange-500/5 rounded-2xl border border-orange-500/10"><h4 className="text-[10px] font-black uppercase text-orange-400 mb-2">Próximos Passos</h4><ul className="text-xs list-disc pl-4 space-y-1">{ata.actionItems?.map((ai, i) => <li key={i}>{ai}</li>)}</ul></div>
                       </div>
                       
                       <div className="p-4 bg-slate-900/30 rounded-xl border border-white/5"><h4 className="text-[10px] font-black uppercase text-slate-500 mb-2">Participantes</h4><div className="flex flex-wrap gap-2">{ata.participants?.map((p, i) => <span key={i} className="px-2 py-1 bg-slate-800 rounded text-[10px] font-bold">{p}</span>)}</div></div>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col h-full">
                    <h3 className="text-xs font-black text-slate-500 uppercase tracking-widest mb-4">Transcrição ao Vivo</h3>
                    <div className="flex-grow space-y-3 overflow-y-auto custom-scrollbar max-h-[400px]">
                      {transcriptions.length === 0 && !isRecording && (
                        <div className="h-full flex flex-col items-center justify-center opacity-30 italic text-sm text-center px-10">
                          Clique no microfone para começar a capturar os pontos da reunião.
                        </div>
                      )}
                      {transcriptions.map((t, i) => (
                        <div key={i} className="p-4 bg-slate-900/50 rounded-2xl border border-white/5 text-sm animate-in slide-in-from-bottom-2">
                           <span className="text-indigo-400 font-bold mr-2 text-[10px] uppercase">Finalizado:</span> {t.text}
                        </div>
                      ))}
                      {isRecording && <div className="p-4 bg-indigo-500/10 border border-indigo-500/20 rounded-2xl text-xs text-indigo-300 animate-pulse">Ouvindo...</div>}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {currentView === 'corrector' && (
          <div className="max-w-4xl mx-auto space-y-8 animate-in fade-in">
            <h2 className="text-3xl font-black flex items-center gap-3">Corretor Gramatical Pro <Sparkles className="text-indigo-400" /></h2>
            <div className="space-y-4">
              <textarea 
                value={textToCorrect} 
                onChange={e => setTextToCorrect(e.target.value)} 
                className="w-full h-48 bg-slate-900 border border-slate-800 rounded-3xl p-6 text-white outline-none focus:border-indigo-500 transition-all resize-none" 
                placeholder="Cole o texto bruto aqui para ser transformado em uma escrita profissional..." 
              />
              <button 
                onClick={correctText} 
                disabled={isCorrecting || !textToCorrect} 
                className="bg-indigo-600 hover:bg-indigo-500 px-8 py-4 rounded-xl font-bold flex items-center gap-2 transition-all disabled:opacity-20"
              >
                {isCorrecting ? <Loader2 className="animate-spin" /> : <Sparkles />} Corrigir e Polir Texto
              </button>
            </div>
            {correctedText && (
              <div className="p-8 bg-indigo-500/5 rounded-[2rem] border border-indigo-500/20 animate-in slide-in-from-top-4">
                <div className="flex justify-between items-center mb-4">
                  <span className="text-[10px] font-black uppercase text-indigo-400 tracking-[0.2em]">Resultado da IA</span>
                  <button onClick={() => { navigator.clipboard.writeText(correctedText); alert("Copiado!"); }} className="text-[10px] font-bold text-slate-500 hover:text-white uppercase transition-colors">Copiar Texto</button>
                </div>
                <p className="text-slate-200 leading-relaxed font-medium">{correctedText}</p>
              </div>
            )}
          </div>
        )}

        {currentView === 'profile' && profile && (
          <div className="max-w-3xl mx-auto space-y-10 animate-in fade-in">
            <h2 className="text-3xl font-black">Configurações de Perfil</h2>
            <div className="glass p-10 rounded-[3rem] border border-white/5 space-y-8 shadow-2xl">
               <div className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-[10px] font-black uppercase text-slate-500">Nome de Exibição</label>
                    <input value={profile.full_name} onChange={e => setProfile({...profile, full_name: e.target.value})} className="w-full bg-slate-900 border border-slate-800 rounded-xl px-4 py-3 text-white outline-none focus:border-indigo-500 transition-all" />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black uppercase text-slate-500">Telefone / Contato</label>
                    <input value={profile.phone} onChange={e => setProfile({...profile, phone: e.target.value})} className="w-full bg-slate-900 border border-slate-800 rounded-xl px-4 py-3 text-white outline-none focus:border-indigo-500 transition-all" placeholder="E.g. +55 11 99999-9999" />
                  </div>
               </div>
               <button 
                 onClick={async () => {
                   const { error } = await supabase.from('profiles').upsert({ ...profile, id: user?.id });
                   if (!error) alert("Perfil atualizado com sucesso!");
                   else alert("Erro ao salvar perfil.");
                 }} 
                 className="w-full bg-indigo-600 py-4 rounded-xl font-bold hover:bg-indigo-500 shadow-xl shadow-indigo-600/20 transition-all"
               >
                 Salvar Alterações
               </button>
            </div>
          </div>
        )}

        {currentView === 'admin' && profile?.role === 'admin' && (
          <div className="max-w-5xl mx-auto space-y-8 animate-in fade-in">
            <h2 className="text-3xl font-black flex items-center gap-3"><ShieldAlert className="text-red-500" /> Painel do Administrador</h2>
            <div className="glass rounded-3xl overflow-hidden border border-white/5">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-950/50 border-b border-slate-800">
                  <tr><th className="p-6 text-[10px] font-black uppercase text-slate-500">Usuário</th><th className="p-6 text-[10px] font-black uppercase text-slate-500">Permissão</th><th className="p-6 text-[10px] font-black uppercase text-slate-500">Gerenciamento</th></tr>
                </thead>
                <tbody className="divide-y divide-slate-800/50">
                  {allUsers.map(u => (
                    <tr key={u.id} className="hover:bg-slate-800/20 transition-colors">
                      <td className="p-6 font-bold text-slate-200">{u.full_name}</td>
                      <td className="p-6"><span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">{u.role}</span></td>
                      <td className="p-6">
                        <button 
                          onClick={async () => {
                            if (confirm(`Deseja remover o acesso de ${u.full_name}?`)) {
                              await supabase.from('profiles').delete().eq('id', u.id);
                              fetchAllUsers();
                            }
                          }} 
                          disabled={u.id === user?.id} 
                          className="text-red-400 text-xs font-bold hover:underline disabled:opacity-20 transition-all"
                        >
                          Remover Conta
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

createRoot(document.getElementById('root')!).render(<App />);
