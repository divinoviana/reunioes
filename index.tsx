
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { GoogleGenAI, Modality, LiveServerMessage } from '@google/genai';
import { createClient, User } from '@supabase/supabase-js';
import { 
  Mic, MicOff, FileText, Download, Trash2, Clock, Users, 
  Calendar, CheckCircle, Save, Loader2, AlertCircle, 
  Cloud, Edit3, RefreshCcw, Type, ChevronRight, LogIn, 
  UserPlus, LogOut, LayoutDashboard, Settings, Sparkles, 
  History, ShieldAlert, ShieldCheck, UserMinus, Zap
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
type View = 'auth' | 'dashboard' | 'studio' | 'profile' | 'admin';

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
  created_at?: string;
}

interface Profile {
  id: string;
  full_name: string;
  phone: string;
  avatar_url: string;
  role: 'user' | 'admin';
  email?: string;
  created_at?: string;
}

const App: React.FC = () => {
  const [currentView, setCurrentView] = useState<View>('auth');
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [transcriptions, setTranscriptions] = useState<TranscriptionEntry[]>([]);
  const [currentLiveText, setCurrentLiveText] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [ata, setAta] = useState<AtaData | null>(null);
  const [meetingTitle, setMeetingTitle] = useState('');
  const [recordingTime, setRecordingTime] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [pastMeetings, setPastMeetings] = useState<AtaData[]>([]);
  const [allUsers, setAllUsers] = useState<Profile[]>([]);
  const [authLoading, setAuthLoading] = useState(false);
  const [isRegistering, setIsRegistering] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [isAdminLoading, setIsAdminLoading] = useState(false);

  const sessionPromiseRef = useRef<any>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);
  const transcriptionAccumulatorRef = useRef('');

  const ADMIN_EMAIL = 'divino.viana@professor.to.gov.br';

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        setUser(session.user);
        fetchProfile(session.user);
        setCurrentView('dashboard');
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      if (session) {
        fetchProfile(session.user);
        setCurrentView('dashboard');
      } else {
        setProfile(null);
        setCurrentView('auth');
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const fetchProfile = async (authUser: User) => {
    try {
      const { data, error: fetchError } = await supabase.from('profiles').select('*').eq('id', authUser.id).single();
      let currentProfile = data;

      if (!data) {
        const { data: newProfile } = await supabase.from('profiles').insert([{
           id: authUser.id,
           full_name: authUser.user_metadata?.full_name || 'Usuário',
           email: authUser.email,
           role: authUser.email === ADMIN_EMAIL ? 'admin' : 'user'
        }]).select().single();
        if (newProfile) currentProfile = newProfile;
      }

      if (authUser.email === ADMIN_EMAIL && currentProfile?.role !== 'admin') {
         const { data: updated } = await supabase.from('profiles').update({ role: 'admin' }).eq('id', authUser.id).select().single();
         if (updated) currentProfile = updated;
      }

      if (currentProfile) {
        setProfile(currentProfile);
        if (currentProfile.role === 'admin') fetchAllUsers();
      }
      fetchMeetings(authUser.id);
    } catch (err) { console.error('Erro ao carregar perfil:', err); }
  };

  const fetchMeetings = async (userId: string) => {
    try {
      const { data } = await supabase.from('meetings').select('*').eq('user_id', userId).order('created_at', { ascending: false });
      if (data) setPastMeetings(data as any);
    } catch (err) { console.error("Erro ao buscar reuniões:", err); }
  };

  const fetchAllUsers = async () => {
    setIsAdminLoading(true);
    const { data } = await supabase.from('profiles').select('*').order('created_at', { ascending: false });
    if (data) setAllUsers(data);
    setIsAdminLoading(false);
  };

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setAuthLoading(true);
    try {
      if (isRegistering) {
        const { error } = await supabase.auth.signUp({ email, password, options: { data: { full_name: fullName } } });
        if (error) throw error;
        alert("Conta criada! Tente o login.");
        setIsRegistering(false);
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch (err: any) { 
      setError(err.message.includes('rate limit') ? 'Limite atingido. Aguarde 15min.' : 'Dados incorretos.'); 
    } finally { setAuthLoading(false); }
  };

  const handleLogout = () => supabase.auth.signOut();

  const toggleUserRole = async (targetUser: Profile) => {
    const newRole = targetUser.role === 'admin' ? 'user' : 'admin';
    const { error } = await supabase.from('profiles').update({ role: newRole }).eq('id', targetUser.id);
    if (!error) fetchAllUsers();
  };

  const deleteUser = async (targetUser: Profile) => {
    if (targetUser.id === user?.id) return;
    if (!confirm(`Excluir ${targetUser.full_name}?`)) return;
    const { error } = await supabase.from('profiles').delete().eq('id', targetUser.id);
    if (!error) fetchAllUsers();
  };

  // --- Optimized Recording ---
  useEffect(() => {
    if (isRecording) {
      timerRef.current = window.setInterval(() => setRecordingTime(prev => prev + 1), 1000);
    } else if (timerRef.current) {
      clearInterval(timerRef.current);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [isRecording]);

  const startMeeting = async () => {
    if (!meetingTitle) { setError("Defina um título."); return; }
    setError(null);
    setTranscriptions([]);
    setCurrentLiveText('');
    setAta(null);
    transcriptionAccumulatorRef.current = '';

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      // Baixa latência: Sample rate de 16k e buffer de 2048 para resposta rápida
      audioContextRef.current = new AudioContext({ sampleRate: 16000 });
      setIsRecording(true);

      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        callbacks: {
          onopen: () => {
            const source = audioContextRef.current!.createMediaStreamSource(stream);
            const processor = audioContextRef.current!.createScriptProcessor(2048, 1, 1);
            processor.onaudioprocess = (e) => {
              const input = e.inputBuffer.getChannelData(0);
              const int16 = new Int16Array(input.length);
              for (let i = 0; i < input.length; i++) int16[i] = input[i] * 32768;
              const base64 = encode(new Uint8Array(int16.buffer));
              sessionPromise.then(s => s.sendRealtimeInput({ media: { data: base64, mimeType: 'audio/pcm;rate=16000' } }));
            };
            source.connect(processor);
            processor.connect(audioContextRef.current!.destination);
          },
          onmessage: (msg: LiveServerMessage) => {
            if (msg.serverContent?.inputTranscription) {
              const text = msg.serverContent.inputTranscription.text;
              transcriptionAccumulatorRef.current += text;
              // Atualização imediata para feedback visual de velocidade
              setCurrentLiveText(transcriptionAccumulatorRef.current);
            }
            if (msg.serverContent?.turnComplete) {
              const final = transcriptionAccumulatorRef.current.trim();
              if (final) {
                setTranscriptions(prev => [...prev, { role: 'user', text: final, timestamp: new Date() }]);
              }
              transcriptionAccumulatorRef.current = '';
              setCurrentLiveText('');
            }
          },
          onerror: () => stopMeeting(),
          onclose: () => setIsRecording(false)
        },
        config: { responseModalities: [Modality.AUDIO], inputAudioTranscription: {} }
      });
      sessionPromiseRef.current = sessionPromise;
    } catch (err) { setError("Erro no microfone."); setIsRecording(false); }
  };

  const stopMeeting = async () => {
    setIsRecording(false);
    if (transcriptionAccumulatorRef.current.trim()) {
      setTranscriptions(prev => [...prev, { role: 'user', text: transcriptionAccumulatorRef.current.trim(), timestamp: new Date() }]);
      transcriptionAccumulatorRef.current = '';
      setCurrentLiveText('');
    }
    streamRef.current?.getTracks().forEach(t => t.stop());
    audioContextRef.current?.close();
    (await sessionPromiseRef.current)?.close();
  };

  // --- Optimized Understanding/ATA Generation ---
  const generateAta = async () => {
    const finalTranscriptions = [...transcriptions];
    if (currentLiveText.trim()) finalTranscriptions.push({ role: 'user', text: currentLiveText.trim(), timestamp: new Date() });
    if (finalTranscriptions.length === 0) { setError("Sem áudio capturado."); return; }

    setIsGenerating(true);
    setError(null);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const transcript = finalTranscriptions.map(t => t.text).join(' ');
      
      // Prompt otimizado para velocidade e precisão
      const res = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: `Analise a transcrição e crie uma ATA direta para: "${meetingTitle}". 
        Transcrição: ${transcript}.
        JSON OBRIGATÓRIO: title, date, time, participants (array), agenda, discussion, decisions, actionItems (array).`,
        config: {
          responseMimeType: 'application/json',
          // Desabilitar pensamento detalhado para ganhar milissegundos
          thinkingConfig: { thinkingBudget: 0 },
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
          title: data.title, date: data.date, time: data.time,
          participants: data.participants, agenda: data.agenda,
          discussion: data.discussion, decisions: data.decisions,
          action_items: data.actionItems, user_id: user.id 
        }]);
        fetchMeetings(user.id);
      }
    } catch (err) { setError("Erro na análise rápida."); }
    finally { setIsGenerating(false); }
  };

  const downloadPDF = () => {
    if (!ata) return;
    const { jsPDF } = (window as any).jspdf;
    const doc = new jsPDF();
    doc.setFont("helvetica", "bold").text("ATA DE REUNIÃO", 105, 20, { align: "center" });
    doc.setFontSize(12).text(ata.title, 105, 30, { align: "center" });
    doc.setFont("helvetica", "normal").text(`Data: ${ata.date} | Hora: ${ata.time}`, 20, 45);
    doc.text(`Participantes: ${ata.participants?.join(', ') || 'Nenhum'}`, 20, 55, { maxWidth: 170 });
    doc.setFont("helvetica", "bold").text("Pauta:", 20, 70);
    doc.setFont("helvetica", "normal").text(ata.agenda || '', 20, 77, { maxWidth: 170 });
    doc.setFont("helvetica", "bold").text("Discussão:", 20, 100);
    doc.setFont("helvetica", "normal").text(ata.discussion || '', 20, 107, { maxWidth: 170 });
    doc.setFont("helvetica", "bold").text("Decisões:", 20, 140);
    doc.setFont("helvetica", "normal").text(ata.decisions || '', 20, 147, { maxWidth: 170 });
    doc.setFont("helvetica", "bold").text("Ações:", 20, 170);
    (ata.actionItems || []).forEach((it, i) => doc.setFont("helvetica", "normal").text(`- ${it}`, 25, 177 + (i * 7)));
    doc.save(`ATA_${ata.title.replace(/\s+/g, '_')}.pdf`);
  };

  const formatSecs = (s: number) => `${Math.floor(s/60).toString().padStart(2,'0')}:${(s%60).toString().padStart(2,'0')}`;

  if (currentView === 'auth') {
    return (
      <div className="min-h-screen bg-[#0b0f1a] flex items-center justify-center p-6">
        <div className="max-w-md w-full glass rounded-[2.5rem] p-10 border border-white/5 shadow-2xl space-y-8 animate-in fade-in zoom-in">
          <div className="text-center space-y-2">
            <div className="bg-indigo-600 w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <Zap className="text-white w-8 h-8 fill-white" />
            </div>
            <h1 className="text-3xl font-black text-white">Atas <span className="text-indigo-400">Turbo</span></h1>
            <p className="text-slate-500 text-sm leading-relaxed">Transcrição e entendimento em tempo real com Gemini 3 Flash.</p>
          </div>
          <form onSubmit={handleAuth} className="space-y-4">
            {isRegistering && <input type="text" placeholder="Nome" value={fullName} onChange={e => setFullName(e.target.value)} className="w-full bg-slate-900 border border-slate-800 rounded-xl px-4 py-3 text-white outline-none focus:border-indigo-500" required />}
            <input type="email" placeholder="E-mail" value={email} onChange={e => setEmail(e.target.value)} className="w-full bg-slate-900 border border-slate-800 rounded-xl px-4 py-3 text-white outline-none focus:border-indigo-500" required />
            <input type="password" placeholder="Senha" value={password} onChange={e => setPassword(e.target.value)} className="w-full bg-slate-900 border border-slate-800 rounded-xl px-4 py-3 text-white outline-none focus:border-indigo-500" required />
            {error && <div className="text-red-400 text-xs bg-red-400/10 p-3 rounded-xl border border-red-400/20 flex gap-2"><AlertCircle className="w-4 h-4 shrink-0" />{error}</div>}
            <button type="submit" className="w-full bg-indigo-600 text-white font-bold py-3 rounded-xl hover:bg-indigo-500 transition-all flex items-center justify-center">{authLoading ? <Loader2 className="animate-spin" /> : (isRegistering ? 'Criar Conta' : 'Entrar')}</button>
          </form>
          <button onClick={() => { setIsRegistering(!isRegistering); setError(null); }} className="w-full text-indigo-400 text-xs font-bold uppercase hover:text-white transition-colors">{isRegistering ? 'Já tenho conta' : 'Criar nova conta'}</button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0b0f1a] text-slate-100 flex font-inter">
      <aside className="w-20 md:w-64 border-r border-slate-800/50 glass flex flex-col p-4 md:p-6 gap-8 z-50">
        <div className="flex items-center gap-3 px-2">
          <div className="bg-indigo-600 p-2 rounded-lg"><Zap className="w-5 h-5 text-white fill-white" /></div>
          <span className="hidden md:block font-black text-lg">Atas Turbo</span>
        </div>
        <nav className="flex flex-col gap-2">
          {[
            { id: 'dashboard', icon: LayoutDashboard, label: 'Dashboard' }, 
            { id: 'studio', icon: Mic, label: 'Estúdio Rápido' }, 
            { id: 'profile', icon: Settings, label: 'Perfil' },
            ...(profile?.role === 'admin' ? [{ id: 'admin', icon: ShieldAlert, label: 'Admin' }] : [])
          ].map(item => (
            <button key={item.id} onClick={() => setCurrentView(item.id as View)} className={`flex items-center gap-4 p-3 rounded-xl transition-all ${currentView === item.id ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/20' : 'text-slate-500 hover:bg-slate-800/50'}`}>
              <item.icon className="w-5 h-5" /><span className="hidden md:block font-bold text-sm">{item.label}</span>
            </button>
          ))}
        </nav>
        <button onClick={handleLogout} className="mt-auto flex items-center gap-4 p-3 rounded-xl text-red-400 hover:bg-red-400/10 transition-all"><LogOut className="w-5 h-5" /><span className="hidden md:block font-bold text-sm">Sair</span></button>
      </aside>

      <main className="flex-grow p-4 md:p-10 overflow-y-auto custom-scrollbar">
        {currentView === 'dashboard' && (
          <div className="max-w-5xl mx-auto space-y-10 animate-in fade-in">
            <h2 className="text-3xl font-black">Olá, {profile?.full_name?.split(' ')[0]}!</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
               <div className="glass p-6 rounded-3xl border border-white/5 flex flex-col justify-between shadow-xl">
                  <History className="text-indigo-400 w-8 h-8 mb-4" />
                  <div><p className="text-4xl font-black">{pastMeetings.length}</p><p className="text-[10px] font-black uppercase text-slate-500">Total de Atas</p></div>
               </div>
            </div>
            <section className="space-y-4">
              <h3 className="text-xs font-black text-slate-500 uppercase tracking-widest">Atas Salvas</h3>
              {pastMeetings.length === 0 ? <div className="p-10 text-center border border-dashed border-slate-800 rounded-3xl opacity-30">Vazio</div> : pastMeetings.map((m, i) => (
                <div key={i} className="glass p-5 rounded-2xl border border-white/5 flex justify-between items-center group hover:border-indigo-500/30 transition-all">
                  <div className="flex items-center gap-4">
                    <div className="bg-slate-900 p-3 rounded-xl"><FileText className="text-indigo-400 w-5 h-5" /></div>
                    <div><h4 className="font-bold">{m.title}</h4><p className="text-[10px] text-slate-500">{m.date}</p></div>
                  </div>
                  <button onClick={() => { setAta(m); setCurrentView('studio'); }} className="bg-slate-800 hover:bg-slate-700 px-4 py-2 rounded-lg text-xs font-bold transition-all">Abrir</button>
                </div>
              ))}
            </section>
          </div>
        )}

        {currentView === 'studio' && (
          <div className="max-w-5xl mx-auto space-y-8 animate-in fade-in">
            <div className="flex justify-between items-center">
              <h2 className="text-2xl font-black flex items-center gap-3">Estúdio <span className="bg-indigo-600/20 text-indigo-400 text-[10px] px-2 py-1 rounded">Flash Mode</span></h2>
              {ata && <button onClick={downloadPDF} className="bg-indigo-600 px-4 py-2 rounded-lg flex items-center gap-2 text-sm font-bold shadow-lg hover:bg-indigo-500 transition-all"><Download className="w-4 h-4" /> PDF</button>}
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
              <div className="lg:col-span-4 glass rounded-[2.5rem] p-10 flex flex-col items-center gap-8 border border-white/5 shadow-2xl">
                <input placeholder="Título da Reunião" value={meetingTitle} onChange={e => setMeetingTitle(e.target.value)} className="w-full bg-slate-900 border border-slate-800 rounded-xl px-4 py-3 text-white outline-none focus:border-indigo-500" />
                <div className="text-center">
                   <span className={`text-6xl font-mono font-black ${isRecording ? 'text-indigo-400' : 'text-slate-700'}`}>{formatSecs(recordingTime)}</span>
                </div>
                <button onClick={isRecording ? stopMeeting : startMeeting} className={`w-32 h-32 rounded-full flex items-center justify-center transition-all ${isRecording ? 'bg-indigo-600/20 border-4 border-indigo-500 animate-pulse' : 'bg-indigo-600 shadow-xl shadow-indigo-600/30'}`}>
                   {isRecording ? <MicOff className="w-12 h-12 text-indigo-400" /> : <Mic className="w-12 h-12 text-white" />}
                </button>
                <button disabled={isRecording || (transcriptions.length === 0 && !currentLiveText)} onClick={generateAta} className="w-full bg-white text-slate-950 font-black py-4 rounded-xl disabled:opacity-20 flex items-center justify-center gap-2 hover:bg-slate-200 transition-all">
                   {isGenerating ? <Loader2 className="w-5 h-5 animate-spin" /> : <Sparkles className="w-5 h-5" />} Analisar Agora
                </button>
                {error && <p className="text-red-400 text-[10px] font-bold text-center">{error}</p>}
              </div>

              <div className="lg:col-span-8 glass rounded-[2.5rem] p-8 border border-white/5 min-h-[500px] flex flex-col">
                {ata ? (
                  <div className="space-y-6 animate-in slide-in-from-right-4">
                    <div className="flex justify-between items-start">
                       <div><h3 className="text-2xl font-black">{ata.title}</h3><p className="text-xs text-slate-500">{ata.date} • {ata.time}</p></div>
                       <button onClick={() => setAta(null)} className="text-[10px] font-bold text-indigo-400 hover:text-white">Refazer</button>
                    </div>
                    <div className="p-5 bg-slate-900/50 rounded-2xl border border-white/5"><h4 className="text-[10px] font-black uppercase text-indigo-400 mb-2">Resumo</h4><p className="text-sm text-slate-300 leading-relaxed italic">"{ata.discussion}"</p></div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="p-5 bg-emerald-500/5 rounded-2xl border border-emerald-500/10"><h4 className="text-[10px] font-black text-emerald-400 uppercase mb-2">Decisões</h4><p className="text-xs text-slate-300">{ata.decisions}</p></div>
                      <div className="p-5 bg-orange-500/5 rounded-2xl border border-orange-500/10"><h4 className="text-[10px] font-black text-orange-400 uppercase mb-2">Ações</h4><ul className="list-disc pl-4 text-xs text-slate-300">{(ata.actionItems || []).map((ai, i) => <li key={i}>{ai}</li>)}</ul></div>
                    </div>
                  </div>
                ) : (
                  <div className="flex-grow flex flex-col">
                    <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-4">Monitoramento Real-time</h4>
                    <div className="flex-grow space-y-4 overflow-y-auto custom-scrollbar max-h-[400px]">
                      {transcriptions.map((t, i) => <div key={i} className="p-4 bg-slate-900/30 rounded-2xl border border-white/5 text-sm leading-relaxed">{t.text}</div>)}
                      {currentLiveText && <div className="p-4 bg-indigo-500/10 border border-indigo-500/20 rounded-2xl text-sm text-indigo-200 leading-relaxed">{currentLiveText}</div>}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {currentView === 'admin' && profile?.role === 'admin' && (
          <div className="max-w-5xl mx-auto space-y-8 animate-in fade-in">
             <h2 className="text-3xl font-black">Admin Panel</h2>
             <div className="glass rounded-[2rem] overflow-hidden border border-white/5">
                <table className="w-full text-left text-sm border-collapse">
                   <thead className="bg-slate-950/50 border-b border-slate-800">
                      <tr><th className="p-6 text-[10px] font-black uppercase text-slate-500">Usuário</th><th className="p-6 text-[10px] font-black uppercase text-slate-500">Cargo</th><th className="p-6 text-[10px] font-black uppercase text-slate-500 text-center">Ação</th></tr>
                   </thead>
                   <tbody className="divide-y divide-slate-800/30">
                      {allUsers.map(u => (
                        <tr key={u.id} className="hover:bg-indigo-500/5 transition-colors">
                           <td className="p-6"><div className="font-bold">{u.full_name}</div><div className="text-[10px] text-slate-500">{u.email}</div></td>
                           <td className="p-6"><span className={`px-2 py-1 rounded text-[10px] font-black uppercase ${u.role === 'admin' ? 'bg-indigo-500 text-white' : 'bg-slate-800 text-slate-500'}`}>{u.role}</span></td>
                           <td className="p-6 flex justify-center gap-2"><button onClick={() => toggleUserRole(u)} className="p-2 bg-slate-800 rounded"><ShieldCheck className="w-4 h-4" /></button><button onClick={() => deleteUser(u)} className="p-2 bg-slate-800 rounded"><Trash2 className="w-4 h-4" /></button></td>
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
