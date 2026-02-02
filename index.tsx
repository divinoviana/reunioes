
import React, { useState, useRef, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { GoogleGenAI } from '@google/genai';
import { createClient, User } from '@supabase/supabase-js';
import { 
  FileText, Download, Trash2, Clock, Users, 
  Calendar, CheckCircle, Save, Loader2, AlertCircle, 
  Cloud, RefreshCcw, LogOut, LayoutDashboard, Settings, 
  Sparkles, History, ShieldAlert, ShieldCheck, UserMinus, 
  Zap, Upload, FileAudio, Music, Check, X, Info
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
  const MAX_FILE_SIZE_MB = 20;

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
      if (data) {
        setProfile(data);
        if (data.role === 'admin') fetchAllUsers();
      }
      fetchMeetings(authUser.id);
    } catch (err) { console.error('Erro ao carregar perfil:', err); }
  };

  const fetchMeetings = async (userId: string) => {
    try {
      const { data } = await supabase.from('meetings').select('*').eq('user_id', userId).order('created_at', { ascending: false });
      if (data) {
        // Normalização dos dados vindo do banco (mudança de nomes de colunas snake_case para camelCase)
        const normalizedData = data.map((m: any) => ({
          ...m,
          actionItems: m.action_items,
          participants: Array.isArray(m.participants) ? m.participants : []
        }));
        setPastMeetings(normalizedData);
      }
    } catch (err) { console.error("Erro ao buscar reuniões:", err); }
  };

  const fetchAllUsers = async () => {
    const { data } = await supabase.from('profiles').select('*').order('created_at', { ascending: false });
    if (data) setAllUsers(data);
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
          options: { data: { full_name: fullName } } 
        });
        if (signUpError) throw signUpError;
        alert("Conta criada com sucesso! Verifique seu e-mail ou faça login.");
        setIsRegistering(false);
      } else {
        const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
        if (signInError) throw signInError;
      }
    } catch (err: any) { 
      setError(err.message || "Erro na autenticação."); 
    } finally { setAuthLoading(false); }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
        setError(`O arquivo excede o limite de ${MAX_FILE_SIZE_MB}MB. Tente um arquivo mais curto ou comprimido.`);
        setSelectedFile(null);
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
    if (!selectedFile) { setError("Por favor, anexe um áudio."); return; }
    if (!meetingTitle) { setError("A reunião precisa de um título."); return; }

    setIsProcessing(true);
    setError(null);
    setProcessingStatus('Codificando áudio (isso pode levar alguns segundos)...');
    
    try {
      const base64Audio = await fileToBase64(selectedFile);
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      
      setProcessingStatus('Gemini está ouvindo e transcrevendo sua reunião...');
      
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
                text: `Analise este áudio e aja como um redator profissional de atas. 
                Título: "${meetingTitle}".
                Retorne um JSON estruturado com: title, date (DD/MM/AAAA), time (HH:MM), participants (lista), agenda, discussion (resumo), decisions (tópicos), actionItems (lista de tarefas).`
              }
            ]
          }
        ],
        config: {
          responseMimeType: 'application/json',
          thinkingConfig: { thinkingBudget: 0 }
        }
      });

      setProcessingStatus('Quase pronto! Organizando o documento...');
      const data = JSON.parse(response.text || '{}');
      setAta(data);

      if (user) {
        const { error: dbError } = await supabase.from('meetings').insert([{ 
          title: data.title || meetingTitle, 
          date: data.date, 
          time: data.time,
          participants: data.participants || [], 
          agenda: data.agenda,
          discussion: data.discussion, 
          decisions: data.decisions,
          action_items: data.actionItems || [], 
          user_id: user.id 
        }]);
        
        if (dbError) throw dbError;
        fetchMeetings(user.id);
      }
    } catch (err: any) {
      console.error(err);
      setError("Falha no processamento. Verifique se o áudio está claro e dentro do limite de 20MB.");
    } finally {
      setIsProcessing(false);
      setProcessingStatus('');
    }
  };

  const downloadPDF = () => {
    if (!ata) return;
    const { jsPDF } = (window as any).jspdf;
    const doc = new jsPDF();
    const margin = 20;
    const pageWidth = 190;

    doc.setFont("helvetica", "bold").setFontSize(18).text("ATA DE REUNIÃO", 105, 25, { align: "center" });
    doc.setFontSize(14).text(ata.title.toUpperCase(), 105, 35, { align: "center" });
    
    doc.setDrawColor(79, 70, 229).setLineWidth(0.5).line(margin, 42, pageWidth, 42);

    doc.setFontSize(10).setFont("helvetica", "bold").text("DADOS GERAIS", margin, 52);
    doc.setFont("helvetica", "normal").text(`Data: ${ata.date}  |  Horário: ${ata.time}`, margin + 5, 60);
    doc.text(`Participantes: ${ata.participants?.join(', ') || 'Não identificados'}`, margin + 5, 67, { maxWidth: 165 });

    doc.setFont("helvetica", "bold").text("1. PAUTA E OBJETIVOS", margin, 80);
    doc.setFont("helvetica", "normal").text(ata.agenda || 'N/A', margin + 5, 87, { maxWidth: 165 });

    doc.setFont("helvetica", "bold").text("2. RESUMO DAS DISCUSSÕES", margin, 110);
    doc.setFont("helvetica", "normal").text(ata.discussion || 'N/A', margin + 5, 117, { maxWidth: 165 });

    doc.setFont("helvetica", "bold").text("3. DECISÕES E ACORDOS", margin, 155);
    doc.setFont("helvetica", "normal").text(ata.decisions || 'N/A', margin + 5, 162, { maxWidth: 165 });

    doc.setFont("helvetica", "bold").text("4. PLANO DE AÇÃO", margin, 190);
    let y = 197;
    (ata.actionItems || []).forEach((item) => {
      doc.setFont("helvetica", "normal").text(`• ${item}`, margin + 5, y, { maxWidth: 165 });
      y += 8;
    });

    doc.setFontSize(8).setTextColor(150).text(`Documento gerado automaticamente por Atas Turbo AI em ${new Date().toLocaleDateString()}`, 105, 285, { align: "center" });

    doc.save(`ATA_${ata.title.replace(/\s+/g, '_')}.pdf`);
  };

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
                <h2 className="text-3xl font-black">Dashboard</h2>
                <p className="text-slate-500 text-sm mt-1">Histórico de reuniões inteligentes.</p>
              </div>
              <button onClick={() => setCurrentView('studio')} className="bg-indigo-600 px-6 py-3 rounded-xl font-bold text-sm flex items-center gap-2 hover:bg-indigo-500 transition-all shadow-lg shadow-indigo-600/20"><Zap className="w-4 h-4 fill-white" /> Criar Agora</button>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
               <div className="glass p-6 rounded-3xl border border-white/5 flex flex-col justify-between shadow-xl">
                  <History className="text-indigo-400 w-8 h-8 mb-4" />
                  <div><p className="text-4xl font-black">{pastMeetings.length}</p><p className="text-[10px] font-black uppercase text-slate-500 tracking-widest">Documentos Salvos</p></div>
               </div>
            </div>

            <section className="space-y-4">
              <h3 className="text-xs font-black text-slate-500 uppercase tracking-widest">Suas Atas</h3>
              {pastMeetings.length === 0 ? (
                <div className="p-20 text-center border border-dashed border-slate-800 rounded-[2.5rem] opacity-30 flex flex-col items-center gap-4">
                  <FileAudio className="w-12 h-12" />
                  <p>Você ainda não processou nenhuma reunião.</p>
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
                        <button onClick={() => { setAta(m); setCurrentView('studio'); }} className="bg-slate-800 hover:bg-slate-700 px-5 py-2 rounded-xl text-xs font-bold transition-all">Abrir</button>
                        <button onClick={async () => { if(confirm("Deseja realmente excluir este documento?")) { await supabase.from('meetings').delete().eq('id', m.id); fetchMeetings(user!.id); } }} className="bg-red-500/10 text-red-400 hover:bg-red-500 hover:text-white p-2 rounded-xl transition-all"><Trash2 className="w-4 h-4" /></button>
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
              <h2 className="text-2xl font-black flex items-center gap-3">Processador de Áudio</h2>
              {ata && <button onClick={downloadPDF} className="bg-indigo-600 px-6 py-3 rounded-xl flex items-center gap-2 text-sm font-bold shadow-lg hover:bg-indigo-500 transition-all"><Download className="w-4 h-4" /> Exportar PDF</button>}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
              <div className="lg:col-span-4 space-y-6">
                <div className="glass rounded-[2rem] p-8 border border-white/5 shadow-2xl flex flex-col gap-6">
                  <div className="space-y-2">
                    <label className="text-[10px] font-black uppercase text-slate-500">Nome do Projeto</label>
                    <input placeholder="Ex: Reunião de Planejamento Q4" value={meetingTitle} onChange={e => setMeetingTitle(e.target.value)} className="w-full bg-slate-900 border border-slate-800 rounded-xl px-4 py-3 text-white outline-none focus:border-indigo-500" />
                  </div>

                  <div className="space-y-2">
                    <label className="text-[10px] font-black uppercase text-slate-500">Anexar Reunião</label>
                    <div 
                      onClick={() => !isProcessing && fileInputRef.current?.click()}
                      className={`cursor-pointer border-2 border-dashed rounded-2xl p-8 flex flex-col items-center justify-center gap-4 transition-all ${selectedFile ? 'border-indigo-500 bg-indigo-500/5' : 'border-slate-800 hover:border-indigo-500/50 hover:bg-white/5'} ${isProcessing ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                      <input type="file" ref={fileInputRef} onChange={handleFileChange} accept="audio/*" className="hidden" />
                      {selectedFile ? (
                        <>
                          <div className="bg-indigo-600 p-4 rounded-full shadow-lg animate-pulse"><FileAudio className="w-8 h-8 text-white" /></div>
                          <div className="text-center">
                            <p className="text-sm font-bold truncate max-w-[150px]">{selectedFile.name}</p>
                            <p className="text-[10px] text-slate-500 font-bold">{(selectedFile.size / (1024 * 1024)).toFixed(2)} MB</p>
                          </div>
                        </>
                      ) : (
                        <>
                          <Upload className="w-8 h-8 text-slate-500" />
                          <div className="text-center">
                            <p className="text-xs font-bold">Clique ou arraste o áudio</p>
                            <p className="text-[10px] text-slate-500 mt-1">Limite máx: {MAX_FILE_SIZE_MB}MB</p>
                          </div>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="bg-indigo-500/5 border border-indigo-500/10 p-4 rounded-xl flex gap-3">
                    <Info className="w-4 h-4 text-indigo-400 shrink-0" />
                    <p className="text-[10px] text-slate-400 leading-relaxed">Dica: Áudios em formato MP3 comprimidos permitem reuniões mais longas dentro do limite de {MAX_FILE_SIZE_MB}MB.</p>
                  </div>

                  <button 
                    disabled={isProcessing || !selectedFile || !meetingTitle} 
                    onClick={generateAta} 
                    className="w-full bg-indigo-600 text-white font-black py-4 rounded-xl disabled:opacity-20 flex items-center justify-center gap-2 hover:bg-indigo-500 transition-all shadow-xl shadow-indigo-600/20"
                  >
                    {isProcessing ? <Loader2 className="w-5 h-5 animate-spin" /> : <Sparkles className="w-5 h-5" />} 
                    {isProcessing ? 'IA Analisando...' : 'Processar Agora'}
                  </button>
                  {error && <p className="text-red-400 text-[10px] font-bold text-center bg-red-400/10 p-3 rounded-lg flex gap-2 items-center"><AlertCircle className="w-3 h-3" /> {error}</p>}
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
                    <Zap className="w-32 h-32 mb-4" />
                    <h3 className="text-2xl font-black">Pronto para Gerar</h3>
                    <p className="max-w-xs text-sm">O Gemini 3 Flash ouvirá seu áudio e criará uma ata estruturada com pautas, decisões e ações.</p>
                  </div>
                )}

                {ata && (
                  <div className="space-y-8 animate-in slide-in-from-bottom-4 duration-500">
                    <div className="border-b border-white/5 pb-6">
                       <h3 className="text-3xl font-black text-indigo-400">{ata.title}</h3>
                       <div className="flex gap-6 mt-4">
                          <div className="flex items-center gap-2 text-xs text-slate-500 font-bold uppercase"><Calendar className="w-4 h-4" /> {ata.date}</div>
                          <div className="flex items-center gap-2 text-xs text-slate-500 font-bold uppercase"><Clock className="w-4 h-4" /> {ata.time}</div>
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
                            <h4 className="text-[10px] font-black uppercase text-orange-400 tracking-[0.2em] mb-3">Ações Pendentes</h4>
                            <div className="space-y-2">
                              {(ata.actionItems || []).map((item, i) => (
                                <div key={i} className="flex gap-3 items-start p-3 bg-orange-500/5 border border-orange-500/10 rounded-xl text-xs text-slate-300">
                                   <CheckCircle className="mt-0.5 w-3 h-3 text-orange-500/50 flex-shrink-0" />
                                   {item}
                                </div>
                              ))}
                            </div>
                          </div>
                       </div>
                    </div>

                    <div className="bg-indigo-600/5 border border-indigo-600/10 p-6 rounded-3xl">
                       <h4 className="text-[10px] font-black uppercase text-indigo-400 tracking-[0.2em] mb-3">Resumo Executivo</h4>
                       <p className="text-sm leading-relaxed text-slate-300 whitespace-pre-wrap">{ata.discussion}</p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

createRoot(document.getElementById('root')!).render(<App />);
