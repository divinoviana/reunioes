
import React, { useState, useRef, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { GoogleGenAI } from '@google/genai';
import { createClient, User } from '@supabase/supabase-js';
import { 
  FileText, Download, Trash2, Clock, Users, 
  Calendar, CheckCircle, Save, Loader2, AlertCircle, 
  Cloud, RefreshCcw, LogOut, LayoutDashboard, Settings, 
  Sparkles, History, ShieldAlert, ShieldCheck, UserMinus, 
  Zap, Upload, FileAudio, Music, Check, X
} from 'lucide-react';

// Supabase Configuration
const SUPABASE_URL = 'https://wuvmwcspalapvxbqunnp.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_TE26qMOqYhJJ3xyLklAcLA_X0WCP1r3';
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// --- Types ---
type View = 'auth' | 'dashboard' | 'studio' | 'profile' | 'admin';

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
}

const App: React.FC = () => {
  const [currentView, setCurrentView] = useState<View>('auth');
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [ata, setAta] = useState<AtaData | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [meetingTitle, setMeetingTitle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pastMeetings, setPastMeetings] = useState<AtaData[]>([]);
  const [allUsers, setAllUsers] = useState<Profile[]>([]);
  const [authLoading, setAuthLoading] = useState(false);
  const [isRegistering, setIsRegistering] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [processingStatus, setProcessingStatus] = useState('');

  const fileInputRef = useRef<HTMLInputElement>(null);
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
      const { data } = await supabase.from('profiles').select('*').eq('id', authUser.id).single();
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
    const { data } = await supabase.from('profiles').select('*').order('created_at', { ascending: false });
    if (data) setAllUsers(data);
  };

  // Fixed: Added deleteUser function to manage user profiles in the admin view
  const deleteUser = async (targetUser: Profile) => {
    if (!confirm(`Tem certeza que deseja excluir o usuário ${targetUser.full_name}?`)) return;
    try {
      const { error } = await supabase.from('profiles').delete().eq('id', targetUser.id);
      if (error) throw error;
      fetchAllUsers();
    } catch (err: any) {
      console.error("Erro ao excluir usuário:", err);
      alert("Erro ao excluir usuário.");
    }
  };

  // Fixed: Added toggleAdmin function for the admin panel action
  const toggleAdmin = async (targetUser: Profile) => {
    const newRole = targetUser.role === 'admin' ? 'user' : 'admin';
    try {
      const { error } = await supabase.from('profiles').update({ role: newRole }).eq('id', targetUser.id);
      if (error) throw error;
      fetchAllUsers();
    } catch (err: any) {
      console.error("Erro ao alterar privilégios:", err);
    }
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
      setError(err.message.includes('rate limit') ? 'Limite atingido. Aguarde 15min.' : 'E-mail ou senha inválidos.'); 
    } finally { setAuthLoading(false); }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 20 * 1024 * 1024) { // 20MB limit
        setError("Arquivo muito grande. Limite de 20MB.");
        return;
      }
      setSelectedFile(file);
      setError(null);
    }
  };

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => resolve(reader.result?.toString().split(',')[1] || '');
      reader.onerror = error => reject(error);
    });
  };

  const generateAta = async () => {
    if (!selectedFile) { setError("Anexe um arquivo de áudio."); return; }
    if (!meetingTitle) { setError("Dê um título para a reunião."); return; }

    setIsProcessing(true);
    setError(null);
    setProcessingStatus('Lendo arquivo de áudio...');
    
    try {
      const base64Audio = await fileToBase64(selectedFile);
      // Fixed: Initialize GoogleGenAI within the function right before use
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      
      setProcessingStatus('IA analisando o áudio e transcrevendo...');
      
      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: [
          {
            parts: [
              {
                inlineData: {
                  data: base64Audio,
                  mimeType: selectedFile.type || 'audio/mpeg'
                }
              },
              {
                text: `Ouça atentamente este áudio de reunião e gere uma ATA profissional completa.
                O título sugerido é: "${meetingTitle}".
                Identifique os participantes pela voz ou contexto.
                Retorne EXCLUSIVAMENTE um JSON com a seguinte estrutura:
                {
                  "title": "string",
                  "date": "string (formato DD/MM/AAAA)",
                  "time": "string (formato HH:MM)",
                  "participants": ["string"],
                  "agenda": "string",
                  "discussion": "string (resumo detalhado)",
                  "decisions": "string (pontos decididos)",
                  "actionItems": ["string (tarefas pendentes)"]
                }`
              }
            ]
          }
        ],
        config: {
          responseMimeType: 'application/json',
          thinkingConfig: { thinkingBudget: 0 }
        }
      });

      setProcessingStatus('Estruturando documento final...');
      // Fixed: Directly access the .text property of GenerateContentResponse
      const data = JSON.parse(response.text || '{}');
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
    } catch (err) {
      console.error(err);
      setError("Erro ao processar áudio. Certifique-se de que é um formato válido.");
    } finally {
      setIsProcessing(false);
      setProcessingStatus('');
    }
  };

  const downloadPDF = () => {
    if (!ata) return;
    const { jsPDF } = (window as any).jspdf;
    const doc = new jsPDF();
    doc.setFont("helvetica", "bold").text("ATA DE REUNIÃO PROFISSIONAL", 105, 20, { align: "center" });
    doc.setFontSize(14).text(ata.title, 105, 30, { align: "center" });
    
    doc.setFontSize(10).setFont("helvetica", "normal");
    doc.text(`Gerado via Atas Turbo AI em: ${new Date().toLocaleString()}`, 20, 40);
    doc.line(20, 42, 190, 42);

    doc.setFont("helvetica", "bold").text("Informações Gerais:", 20, 50);
    doc.setFont("helvetica", "normal").text(`Data: ${ata.date} | Horário: ${ata.time}`, 25, 57);
    doc.text(`Participantes: ${ata.participants?.join(', ') || 'N/A'}`, 25, 64, { maxWidth: 165 });

    doc.setFont("helvetica", "bold").text("Pauta / Objetivo:", 20, 75);
    doc.setFont("helvetica", "normal").text(ata.agenda || '', 25, 82, { maxWidth: 165 });

    doc.setFont("helvetica", "bold").text("Resumo da Discussão:", 20, 100);
    doc.setFont("helvetica", "normal").text(ata.discussion || '', 25, 107, { maxWidth: 165 });

    doc.setFont("helvetica", "bold").text("Decisões Tomadas:", 20, 140);
    doc.setFont("helvetica", "normal").text(ata.decisions || '', 25, 147, { maxWidth: 165 });

    doc.setFont("helvetica", "bold").text("Plano de Ação / Tarefas:", 20, 175);
    (ata.actionItems || []).forEach((item, i) => {
      doc.setFont("helvetica", "normal").text(`[ ] ${item}`, 25, 182 + (i * 7), { maxWidth: 165 });
    });

    doc.save(`ATA_${ata.title.replace(/\s+/g, '_')}.pdf`);
  };

  if (currentView === 'auth') {
    return (
      <div className="min-h-screen bg-[#0b0f1a] flex items-center justify-center p-6">
        <div className="max-w-md w-full glass rounded-[2.5rem] p-10 border border-white/5 shadow-2xl space-y-8 animate-in fade-in zoom-in">
          <div className="text-center space-y-2">
            <div className="bg-indigo-600 w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <Zap className="text-white w-8 h-8 fill-white" />
            </div>
            <h1 className="text-3xl font-black text-white">Atas <span className="text-indigo-400">Turbo</span></h1>
            <p className="text-slate-500 text-sm">Anexe o áudio e receba a ATA em segundos.</p>
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
            { id: 'studio', icon: Upload, label: 'Nova ATA' }, 
            { id: 'profile', icon: Settings, label: 'Perfil' },
            ...(profile?.role === 'admin' ? [{ id: 'admin', icon: ShieldAlert, label: 'Admin' }] : [])
          ].map(item => (
            <button key={item.id} onClick={() => { setCurrentView(item.id as View); setAta(null); setSelectedFile(null); }} className={`flex items-center gap-4 p-3 rounded-xl transition-all ${currentView === item.id ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/20' : 'text-slate-500 hover:bg-slate-800/50'}`}>
              <item.icon className="w-5 h-5" /><span className="hidden md:block font-bold text-sm">{item.label}</span>
            </button>
          ))}
        </nav>
        <button onClick={() => supabase.auth.signOut()} className="mt-auto flex items-center gap-4 p-3 rounded-xl text-red-400 hover:bg-red-400/10 transition-all"><LogOut className="w-5 h-5" /><span className="hidden md:block font-bold text-sm">Sair</span></button>
      </aside>

      <main className="flex-grow p-4 md:p-10 overflow-y-auto custom-scrollbar">
        {currentView === 'dashboard' && (
          <div className="max-w-5xl mx-auto space-y-10 animate-in fade-in">
            <div className="flex justify-between items-end">
              <div>
                <h2 className="text-3xl font-black">Olá, {profile?.full_name?.split(' ')[0]}!</h2>
                <p className="text-slate-500 text-sm mt-1">Aqui estão suas reuniões arquivadas.</p>
              </div>
              <button onClick={() => setCurrentView('studio')} className="bg-indigo-600 px-6 py-3 rounded-xl font-bold text-sm flex items-center gap-2 hover:bg-indigo-500 transition-all shadow-lg shadow-indigo-600/20"><Zap className="w-4 h-4 fill-white" /> Criar Nova ATA</button>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
               <div className="glass p-6 rounded-3xl border border-white/5 flex flex-col justify-between shadow-xl">
                  <History className="text-indigo-400 w-8 h-8 mb-4" />
                  <div><p className="text-4xl font-black">{pastMeetings.length}</p><p className="text-[10px] font-black uppercase text-slate-500 tracking-widest">Atas Totais</p></div>
               </div>
            </div>

            <section className="space-y-4">
              <h3 className="text-xs font-black text-slate-500 uppercase tracking-widest">Arquivo Recente</h3>
              {pastMeetings.length === 0 ? (
                <div className="p-20 text-center border border-dashed border-slate-800 rounded-[2.5rem] opacity-30 flex flex-col items-center gap-4">
                  <FileAudio className="w-12 h-12" />
                  <p>Nenhuma ATA processada ainda.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-4">
                  {pastMeetings.map((m, i) => (
                    <div key={i} className="glass p-6 rounded-[1.5rem] border border-white/5 flex justify-between items-center group hover:border-indigo-500/30 transition-all">
                      <div className="flex items-center gap-5">
                        <div className="bg-slate-900 p-4 rounded-2xl"><FileText className="text-indigo-400 w-6 h-6" /></div>
                        <div><h4 className="font-bold text-lg">{m.title}</h4><div className="flex gap-4 mt-1"><span className="text-[10px] text-slate-500 font-bold uppercase">{m.date}</span><span className="text-[10px] text-slate-500 font-bold uppercase">{m.time}</span></div></div>
                      </div>
                      <div className="flex gap-2">
                        <button onClick={() => { setAta(m); setCurrentView('studio'); }} className="bg-slate-800 hover:bg-slate-700 px-5 py-2 rounded-xl text-xs font-bold transition-all">Visualizar</button>
                        <button onClick={async () => { if(confirm("Excluir?")) { await supabase.from('meetings').delete().eq('id', m.id); fetchMeetings(user!.id); } }} className="bg-red-500/10 text-red-400 hover:bg-red-500 hover:text-white p-2 rounded-xl transition-all"><Trash2 className="w-4 h-4" /></button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        )}

        {currentView === 'studio' && (
          <div className="max-w-5xl mx-auto space-y-8 animate-in fade-in">
            <div className="flex justify-between items-center">
              <h2 className="text-2xl font-black flex items-center gap-3">Estúdio de ATA <span className="bg-indigo-600/20 text-indigo-400 text-[10px] px-2 py-1 rounded">Audio Mode</span></h2>
              {ata && <button onClick={downloadPDF} className="bg-indigo-600 px-6 py-3 rounded-xl flex items-center gap-2 text-sm font-bold shadow-lg hover:bg-indigo-500 transition-all"><Download className="w-4 h-4" /> Baixar PDF</button>}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
              <div className="lg:col-span-4 space-y-6">
                <div className="glass rounded-[2rem] p-8 border border-white/5 shadow-2xl flex flex-col gap-6">
                  <div className="space-y-2">
                    <label className="text-[10px] font-black uppercase text-slate-500">Identificação</label>
                    <input placeholder="Título da Reunião" value={meetingTitle} onChange={e => setMeetingTitle(e.target.value)} className="w-full bg-slate-900 border border-slate-800 rounded-xl px-4 py-3 text-white outline-none focus:border-indigo-500" />
                  </div>

                  <div className="space-y-2">
                    <label className="text-[10px] font-black uppercase text-slate-500">Arquivo de Áudio</label>
                    <div 
                      onClick={() => fileInputRef.current?.click()}
                      className={`cursor-pointer border-2 border-dashed rounded-2xl p-8 flex flex-col items-center justify-center gap-4 transition-all ${selectedFile ? 'border-indigo-500 bg-indigo-500/5' : 'border-slate-800 hover:border-indigo-500/50 hover:bg-white/5'}`}
                    >
                      <input type="file" ref={fileInputRef} onChange={handleFileChange} accept="audio/*" className="hidden" />
                      {selectedFile ? (
                        <>
                          <div className="bg-indigo-600 p-4 rounded-full shadow-lg shadow-indigo-600/30 animate-bounce"><Music className="w-8 h-8 text-white" /></div>
                          <div className="text-center">
                            <p className="text-sm font-bold truncate max-w-[150px]">{selectedFile.name}</p>
                            <p className="text-[10px] text-slate-500 font-bold">{(selectedFile.size / (1024 * 1024)).toFixed(2)} MB</p>
                          </div>
                          <button onClick={(e) => { e.stopPropagation(); setSelectedFile(null); }} className="text-[10px] text-red-400 font-black uppercase hover:text-white flex items-center gap-1"><X className="w-3 h-3" /> Remover</button>
                        </>
                      ) : (
                        <>
                          <Upload className="w-8 h-8 text-slate-500" />
                          <div className="text-center">
                            <p className="text-xs font-bold">Clique para anexar</p>
                            <p className="text-[10px] text-slate-500 mt-1">MP3, WAV, M4A até 20MB</p>
                          </div>
                        </>
                      )}
                    </div>
                  </div>

                  <button 
                    disabled={isProcessing || !selectedFile || !meetingTitle} 
                    onClick={generateAta} 
                    className="w-full bg-indigo-600 text-white font-black py-4 rounded-xl disabled:opacity-20 flex items-center justify-center gap-2 hover:bg-indigo-500 transition-all shadow-xl shadow-indigo-600/20"
                  >
                    {isProcessing ? <Loader2 className="w-5 h-5 animate-spin" /> : <Sparkles className="w-5 h-5" />} 
                    {isProcessing ? 'Processando...' : 'Gerar ATA Profissional'}
                  </button>
                  {error && <p className="text-red-400 text-[10px] font-bold text-center bg-red-400/10 p-2 rounded-lg">{error}</p>}
                </div>

                {isProcessing && (
                  <div className="glass rounded-[1.5rem] p-6 border border-white/5 animate-pulse">
                    <div className="flex items-center gap-3">
                      <div className="w-2 h-2 bg-indigo-500 rounded-full animate-ping"></div>
                      <p className="text-xs font-bold text-indigo-400">{processingStatus}</p>
                    </div>
                  </div>
                )}
              </div>

              <div className="lg:col-span-8 glass rounded-[2.5rem] p-10 border border-white/5 min-h-[600px] flex flex-col relative overflow-hidden">
                {!ata && !isProcessing && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center opacity-10 text-center p-10">
                    <FileAudio className="w-32 h-32 mb-4" />
                    <h3 className="text-2xl font-black">Nenhum Documento Gerado</h3>
                    <p className="max-w-xs text-sm">Anexe o áudio da reunião ao lado e clique em "Gerar" para começar a análise inteligente.</p>
                  </div>
                )}

                {isProcessing && (
                  <div className="flex-grow flex flex-col items-center justify-center space-y-6">
                    <div className="relative">
                      <div className="w-24 h-24 border-4 border-indigo-600/20 border-t-indigo-600 rounded-full animate-spin"></div>
                      <Zap className="absolute inset-0 m-auto w-8 h-8 text-indigo-400 fill-indigo-400" />
                    </div>
                    <div className="text-center">
                      <h4 className="text-xl font-black">Analisando Áudio...</h4>
                      <p className="text-slate-500 text-sm mt-2">Nossa IA está ouvindo e organizando os pontos chave.</p>
                    </div>
                  </div>
                )}

                {ata && (
                  <div className="space-y-8 animate-in slide-in-from-bottom-4 duration-500">
                    <div className="border-b border-white/5 pb-6">
                       <h3 className="text-3xl font-black text-indigo-400">{ata.title}</h3>
                       <div className="flex gap-6 mt-4">
                          <div className="flex items-center gap-2 text-xs text-slate-500 font-bold"><Calendar className="w-4 h-4" /> {ata.date}</div>
                          <div className="flex items-center gap-2 text-xs text-slate-500 font-bold"><Clock className="w-4 h-4" /> {ata.time}</div>
                       </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                       <div className="space-y-6">
                          <div>
                            <h4 className="text-[10px] font-black uppercase text-slate-500 tracking-[0.2em] mb-3">Participantes</h4>
                            <div className="flex flex-wrap gap-2">
                              {(ata.participants || []).map((p, i) => (
                                <span key={i} className="px-3 py-1 bg-slate-800 rounded-lg text-[10px] font-bold border border-white/5 flex items-center gap-2"><div className="w-1.5 h-1.5 rounded-full bg-indigo-500"></div>{p}</span>
                              ))}
                            </div>
                          </div>
                          <div>
                            <h4 className="text-[10px] font-black uppercase text-slate-500 tracking-[0.2em] mb-3">Pauta Principal</h4>
                            <p className="text-sm leading-relaxed text-slate-300 bg-slate-900/50 p-4 rounded-2xl border border-white/5">{ata.agenda}</p>
                          </div>
                       </div>

                       <div className="space-y-6">
                          <div>
                            <h4 className="text-[10px] font-black uppercase text-emerald-400 tracking-[0.2em] mb-3">Decisões Tomadas</h4>
                            <div className="p-4 bg-emerald-500/5 border border-emerald-500/20 rounded-2xl text-sm text-slate-300 leading-relaxed italic">
                              {ata.decisions}
                            </div>
                          </div>
                          <div>
                            <h4 className="text-[10px] font-black uppercase text-orange-400 tracking-[0.2em] mb-3">Plano de Ação</h4>
                            <div className="space-y-2">
                              {(ata.actionItems || []).map((item, i) => (
                                <div key={i} className="flex gap-3 items-start p-3 bg-orange-500/5 border border-orange-500/10 rounded-xl text-xs text-slate-300">
                                   <div className="mt-1 w-3 h-3 rounded border border-orange-500/30 flex-shrink-0"></div>
                                   {item}
                                </div>
                              ))}
                            </div>
                          </div>
                       </div>
                    </div>

                    <div className="bg-indigo-600/5 border border-indigo-600/10 p-6 rounded-3xl">
                       <h4 className="text-[10px] font-black uppercase text-indigo-400 tracking-[0.2em] mb-3">Resumo da Discussão</h4>
                       <p className="text-sm leading-relaxed text-slate-300 whitespace-pre-wrap">{ata.discussion}</p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {currentView === 'profile' && profile && (
          <div className="max-w-2xl mx-auto space-y-10 animate-in fade-in">
            <h2 className="text-3xl font-black">Configurações de Perfil</h2>
            <div className="glass p-10 rounded-[2.5rem] border border-white/5 space-y-8 shadow-2xl">
               <div className="flex items-center gap-6">
                  <div className="w-24 h-24 bg-indigo-600 rounded-3xl flex items-center justify-center text-4xl font-black">{profile.full_name.charAt(0)}</div>
                  <div><h3 className="text-xl font-black">{profile.full_name}</h3><p className="text-slate-500">{profile.email}</p></div>
               </div>
               <div className="space-y-4">
                  <div className="space-y-2"><label className="text-[10px] font-black uppercase text-slate-500">Nome Exibido</label><input value={profile.full_name} readOnly className="w-full bg-slate-900/50 border border-slate-800 rounded-xl px-4 py-3 text-slate-400 outline-none" /></div>
                  <div className="space-y-2"><label className="text-[10px] font-black uppercase text-slate-500">Tipo de Conta</label><div className="bg-indigo-600/10 text-indigo-400 border border-indigo-600/20 px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest">{profile.role}</div></div>
               </div>
               <div className="pt-6 border-t border-white/5 flex gap-4">
                  <button onClick={() => setCurrentView('dashboard')} className="flex-grow bg-white text-slate-950 font-bold py-3 rounded-xl hover:bg-slate-200 transition-all">Voltar ao Painel</button>
                  <button onClick={() => supabase.auth.signOut()} className="bg-red-500/10 text-red-400 font-bold px-6 py-3 rounded-xl hover:bg-red-500 hover:text-white transition-all">Sair da Conta</button>
               </div>
            </div>
          </div>
        )}

        {currentView === 'admin' && profile?.role === 'admin' && (
          <div className="max-w-5xl mx-auto space-y-8 animate-in fade-in">
             <div className="flex justify-between items-center">
                <h2 className="text-3xl font-black flex items-center gap-3">Painel de Controle</h2>
                <div className="bg-indigo-600/10 text-indigo-400 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest border border-indigo-400/20">Administrador Root</div>
             </div>
             <div className="glass rounded-[2rem] overflow-hidden border border-white/5 shadow-2xl">
                <table className="w-full text-left text-sm border-collapse">
                   <thead className="bg-slate-950/50 border-b border-slate-800">
                      <tr><th className="p-6 text-[10px] font-black uppercase text-slate-500">Usuário</th><th className="p-6 text-[10px] font-black uppercase text-slate-500">Status</th><th className="p-6 text-[10px] font-black uppercase text-slate-500 text-center">Ações Rápidas</th></tr>
                   </thead>
                   <tbody className="divide-y divide-slate-800/30">
                      {allUsers.map(u => (
                        <tr key={u.id} className="hover:bg-indigo-500/5 transition-colors">
                           <td className="p-6"><div className="font-bold text-lg">{u.full_name}</div><div className="text-xs text-slate-500">{u.email}</div></td>
                           <td className="p-6"><span className={`px-3 py-1 rounded-lg text-[10px] font-black uppercase ${u.role === 'admin' ? 'bg-indigo-500 text-white shadow-lg shadow-indigo-500/20' : 'bg-slate-800 text-slate-500'}`}>{u.role}</span></td>
                           <td className="p-6 flex justify-center gap-3">
                             {/* Fixed: Implemented toggleAdmin to change user roles */}
                             <button onClick={() => toggleAdmin(u)} className="p-3 bg-slate-800 rounded-xl hover:bg-indigo-600 hover:text-white transition-all"><ShieldCheck className="w-4 h-4" /></button>
                             {/* Fixed: Implemented deleteUser to remove user profiles */}
                             <button onClick={() => deleteUser(u)} className="p-3 bg-slate-800 rounded-xl hover:bg-red-500 hover:text-white transition-all"><Trash2 className="w-4 h-4" /></button>
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
