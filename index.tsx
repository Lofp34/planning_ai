import React, { useState, useEffect, useCallback, useRef, StrictMode } from 'react';
import ReactDOM from 'react-dom/client';
import { GoogleGenAI, Type } from "@google/genai";
import { supabase } from './supabaseClient';
import { Auth } from '@supabase/auth-ui-react';
import { ThemeSupa } from '@supabase/auth-ui-shared';
import { Session } from '@supabase/supabase-js';
import { startOfWeek, endOfWeek, addDays, format, eachDayOfInterval, parseISO } from 'date-fns';
import { fr } from 'date-fns/locale';
import './index.css';

// --- TYPES ---
type TaskCategory = 'Perso' | 'Travail' | 'Santé' | 'Étude' | 'Admin';
type TaskPriority = 'haute' | 'moyenne' | 'basse';

interface Card {
    id: string;
    user_id: string;
    created_at: string;
    title: string;
    subtasks: string[];
    datetime_start: string;
    datetime_end: string;
    duration_min: number;
    category: TaskCategory;
    priority: TaskPriority;
    notes?: string;
}

interface ScheduleData {
    [day: string]: Card[];
}

// --- Web Speech API Types ---
// These declarations are added to provide type information for the
// experimental Web Speech API, resolving TypeScript errors.
interface SpeechRecognitionEvent extends Event {
    readonly resultIndex: number;
    readonly results: SpeechRecognitionResultList;
}

interface SpeechRecognitionResultList {
    readonly length: number;
    item(index: number): SpeechRecognitionResult;
    [index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionResult {
    readonly isFinal: boolean;
    readonly length: number;
    item(index: number): SpeechRecognitionAlternative;
    [index: number]: SpeechRecognitionAlternative;
}

interface SpeechRecognitionAlternative {
    readonly transcript: string;
    readonly confidence: number;
}

interface SpeechRecognitionErrorEvent extends Event {
    readonly error: string;
    readonly message: string;
}

interface SpeechRecognitionStatic {
    new(): SpeechRecognition;
}

interface SpeechRecognition extends EventTarget {
    continuous: boolean;
    interimResults: boolean;
    lang: string;

    start(): void;
    stop(): void;
    abort(): void;

    onresult: ((this: SpeechRecognition, ev: SpeechRecognitionEvent) => any) | null;
    onerror: ((this: SpeechRecognition, ev: SpeechRecognitionErrorEvent) => any) | null;
    onstart: ((this: SpeechRecognition, ev: Event) => any) | null;
    onend: ((this: SpeechRecognition, ev: Event) => any) | null;
}

declare global {
    interface Window {
        SpeechRecognition: SpeechRecognitionStatic;
        webkitSpeechRecognition: SpeechRecognitionStatic;
    }
}


// --- AI & LOGIC HELPERS ---
const ai = new GoogleGenAI({ apiKey: import.meta.env.VITE_GEMINI_API_KEY });

const sortCards = (cards: Card[]): Card[] => {
    return [...cards].sort((a, b) => {
        const timeA = new Date(a.datetime_start).getTime();
        const timeB = new Date(b.datetime_start).getTime();
        return timeA - timeB;
    });
};

const cardSchema = {
    type: Type.OBJECT,
    properties: {
        title: { type: Type.STRING, description: "Titre concis de la tâche." },
        subtasks: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Liste des sous-tâches ou étapes." },
        datetime_start: { type: Type.STRING, description: `Date et heure de début au format 'YYYY-MM-DD HH:MM'. Aujourd'hui est ${format(new Date(), 'yyyy-MM-dd')}.` },
        datetime_end: { type: Type.STRING, description: `Date et heure de fin au format 'YYYY-MM-DD HH:MM'.` },
        duration_min: { type: Type.INTEGER, description: "Durée totale de la tâche en minutes." },
        category: { type: Type.STRING, description: "Catégorie parmi 'Perso', 'Travail', 'Santé', 'Étude', 'Admin'." },
        priority: { type: Type.STRING, description: "Priorité parmi 'haute', 'moyenne', 'basse'." },
        notes: { type: Type.STRING, description: "Notes ou commentaires supplémentaires (optionnel)." }
    },
     required: ["title", "subtasks", "datetime_start", "datetime_end", "duration_min", "category", "priority"]
};

const subtasksSchema = {
    type: Type.OBJECT,
    properties: {
        details: { type: Type.STRING, description: "Une liste de sous-tâches suggérées, formatée avec des tirets ou des numéros." }
    }
};

// --- HOOKS ---
const useKanbanState = (session: Session | null, currentDate: Date) => {
    const [scheduleData, setScheduleData] = useState<ScheduleData>({});
    const [weekDays, setWeekDays] = useState<Date[]>([]);

    const fetchTasks = useCallback(async () => {
        if (!session?.user) return;

        const start = startOfWeek(currentDate, { locale: fr });
        const end = endOfWeek(currentDate, { locale: fr });
        setWeekDays(eachDayOfInterval({ start, end }));

        const { data: tasks, error } = await supabase
            .from('tasks')
            .select('*')
            .eq('user_id', session.user.id)
            .gte('datetime_start', start.toISOString())
            .lte('datetime_start', end.toISOString());

        if (error) {
            console.error('Error fetching tasks:', error);
            setScheduleData({});
        } else {
            const newScheduleData: ScheduleData = {};
            // Initialize columns for each day of the week
            eachDayOfInterval({ start, end }).forEach(day => {
                newScheduleData[format(day, 'yyyy-MM-dd')] = [];
            });
            
            // Populate columns with tasks
            tasks.forEach(task => {
                const taskDate = parseISO(task.datetime_start);
                const taskDateStr = format(taskDate, 'yyyy-MM-dd');
                if (newScheduleData[taskDateStr]) {
                    newScheduleData[taskDateStr].push({ ...task, id: task.id.toString() });
                }
            });

            // Sort tasks within each day's column
            for (const day in newScheduleData) {
                newScheduleData[day] = sortCards(newScheduleData[day]);
            }
            setScheduleData(newScheduleData);
        }
    }, [session, currentDate]);

    useEffect(() => {
        fetchTasks();
    }, [fetchTasks]);


    const findCardLocation = (cardId: string | undefined) => {
        if (!cardId) return null;
        for (const day in scheduleData) {
            const cardIndex = scheduleData[day].findIndex(c => c.id === cardId);
            if (cardIndex > -1) return { columnName: day, cardIndex, card: scheduleData[day][cardIndex] };
        }
        return null;
    };

    const addCard = async (card: Omit<Card, 'id' | 'user_id' | 'created_at'>) => {
        if (!session?.user) return;
        
        const { data, error } = await supabase
            .from('tasks')
            .insert([{ ...card, user_id: session.user.id }])
            .select();

        if (error) {
            console.error('Error adding card:', error);
        } else if (data) {
           fetchTasks();
        }
    };

    const updateCard = async (updatedCard: Card) => {
        if (!session?.user) return;
        
        const { id, user_id, created_at, ...updateData } = updatedCard;

        const { error } = await supabase
            .from('tasks')
            .update(updateData)
            .eq('id', updatedCard.id);

        if (error) {
            console.error('Error updating card:', error);
        } else {
            fetchTasks();
        }
    };
    
    const moveCard = async (cardId: string, targetDay: string) => {
        const location = findCardLocation(cardId);
        if (!location) return;

        const originalCard = location.card;
        const originalStartDate = new Date(originalCard.datetime_start);
        
        const targetDate = new Date(targetDay);
        targetDate.setHours(originalStartDate.getHours(), originalStartDate.getMinutes());
        
        const newStartDate = targetDate.toISOString();
        const newEndDate = new Date(targetDate.getTime() + originalCard.duration_min * 60000).toISOString();

        const { error } = await supabase
            .from('tasks')
            .update({ datetime_start: newStartDate, datetime_end: newEndDate })
            .eq('id', cardId);

        if (error) {
            console.error('Error moving card:', error);
        }
        fetchTasks(); // Refetch to show the result
    };

    return { scheduleData, weekDays, addCard, updateCard, moveCard, findCardLocation };
};

const useSpeechRecognition = (onResult: (transcript: string) => void) => {
    const [isListening, setIsListening] = useState(false);
    const recognitionRef = useRef<SpeechRecognition | null>(null);

    useEffect(() => {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) {
            console.warn("Speech recognition not supported in this browser.");
            return;
        }
        const recognition: SpeechRecognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = 'fr-FR';

        recognition.onresult = (event) => {
            let finalTranscript = '';
            for (let i = event.resultIndex; i < event.results.length; ++i) {
                if (event.results[i].isFinal) {
                    finalTranscript += event.results[i][0].transcript;
                }
            }
            if (finalTranscript) {
                onResult(finalTranscript);
            }
        };
        recognition.onstart = () => setIsListening(true);
        recognition.onend = () => setIsListening(false);
        recognition.onerror = (event) => console.error('Speech recognition error:', event.error);

        recognitionRef.current = recognition;
    }, [onResult]);

    const toggleListening = () => {
        if (!recognitionRef.current) return;
        if (isListening) {
            recognitionRef.current.stop();
        } else {
            recognitionRef.current.start();
        }
    };

    return { isListening, toggleListening, isSupported: !!recognitionRef.current };
};


// --- COMPONENTS ---

const ConfirmationModal = ({ isOpen, onConfirm, onCancel }: { isOpen: boolean, onConfirm: (() => void) | null, onCancel: () => void }) => {
    if (!isOpen) return null;
    return (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center p-4 confirmation-modal">
            <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-6 text-center">
                <div className="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-yellow-100">
                    <svg className="h-6 w-6 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path>
                    </svg>
                </div>
                <h3 className="text-lg leading-6 font-medium text-gray-900 mt-4">Attention : Conflit de planning</h3>
                <div className="mt-2 px-7 py-3">
                    <p className="text-sm text-gray-500">Une activité est déjà présente sur ce créneau. Voulez-vous continuer quand même ?</p>
                </div>
                <div className="mt-4 flex justify-center space-x-4">
                    <button onClick={onConfirm || undefined} className="px-4 py-2 bg-yellow-500 text-white text-base font-medium rounded-md w-auto hover:bg-yellow-600">Valider quand même</button>
                    <button onClick={onCancel} className="px-4 py-2 bg-gray-200 text-gray-800 text-base font-medium rounded-md w-auto hover:bg-gray-300">Choisir une autre date</button>
                </div>
            </div>
        </div>
    );
};


const CardModal = ({ card, onClose, onSave, onSuggestSubtasks }: { card: Card | 'new' | Partial<Card>, onClose: () => void, onSave: (formData: any, cardId?: string) => void, onSuggestSubtasks: (title: string) => Promise<string | null> }) => {
    const isNew = card === 'new' || !(card as Card).id;
    const [formData, setFormData] = useState({
        title: isNew ? (card as Partial<Card>)?.title || '' : (card as Card).title,
        datetime_start: isNew ? format(new Date(), "yyyy-MM-dd'T'HH:mm") : format(parseISO((card as Card).datetime_start), "yyyy-MM-dd'T'HH:mm"),
        duration_min: isNew ? (card as Partial<Card>)?.duration_min || 60 : (card as Card).duration_min,
        category: isNew ? (card as Partial<Card>)?.category || 'Travail' : (card as Card).category,
        priority: isNew ? (card as Partial<Card>)?.priority || 'moyenne' : (card as Card).priority,
        subtasks: isNew ? (card as Partial<Card>)?.subtasks || [] : (card as Card).subtasks,
        notes: isNew ? (card as Partial<Card>)?.notes || '' : (card as Card).notes,
    });
    const [isSuggesting, setIsSuggesting] = useState(false);
    
    useEffect(() => {
        if (!isNew) {
            setFormData({
                title: (card as Card).title,
                datetime_start: format(parseISO((card as Card).datetime_start), "yyyy-MM-dd'T'HH:mm"),
                duration_min: (card as Card).duration_min,
                category: (card as Card).category,
                priority: (card as Card).priority,
                subtasks: (card as Card).subtasks,
                notes: (card as Card).notes || '',
            });
        }
    }, [card]);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const handleSubtaskChange = (index: number, value: string) => {
        const newSubtasks = [...formData.subtasks];
        newSubtasks[index] = value;
        setFormData(prev => ({ ...prev, subtasks: newSubtasks }));
    };

    const addSubtask = () => {
        setFormData(prev => ({ ...prev, subtasks: [...prev.subtasks, ''] }));
    };

    const removeSubtask = (index: number) => {
        const newSubtasks = formData.subtasks.filter((_, i) => i !== index);
        setFormData(prev => ({ ...prev, subtasks: newSubtasks }));
    };

    const handleSuggest = async () => {
        setIsSuggesting(true);
        const suggestion = await onSuggestSubtasks(formData.title);
        if (suggestion) {
            // Logic to parse suggestion and add as subtasks
        }
        setIsSuggesting(false);
    };

    const handleSave = () => {
        if (!formData.title) return alert("Le titre est obligatoire.");
        
        const startDate = new Date(formData.datetime_start);
        const endDate = new Date(startDate.getTime() + formData.duration_min * 60000);

        const dataToSave = {
            ...formData,
            datetime_end: endDate.toISOString(),
            subtasks: formData.subtasks.filter(st => st.trim() !== ''), // Clean empty subtasks
        };

        onSave(dataToSave, (card as Card)?.id);
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 modal-backdrop" onClick={onClose}>
            <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl p-6 relative max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
                {/* Close Button */}
                <button onClick={onClose} className="absolute top-4 right-4 text-gray-500 hover:text-gray-800 z-10">
                    {/* SVG icon */}
                </button>
                
                {/* Title */}
                <input type="text" name="title" value={formData.title} onChange={handleChange} placeholder="Titre de la tâche" className="text-2xl font-bold w-full border-b-2 border-gray-300 focus:border-blue-500 outline-none pb-2 mb-4" />
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Left Column */}
                    <div>
                        {/* Datetime Start */}
                        <div className="mb-4">
                            <label className="font-semibold text-gray-700 block mb-1">Début</label>
                            <input type="datetime-local" name="datetime_start" value={formData.datetime_start} onChange={handleChange} className="w-full p-2 border rounded-md"/>
                        </div>
                        
                        {/* Duration */}
                        <div className="mb-4">
                            <label className="font-semibold text-gray-700 block mb-1">Durée (minutes)</label>
                            <input type="number" name="duration_min" value={formData.duration_min} onChange={handleChange} className="w-full p-2 border rounded-md"/>
                        </div>

                        {/* Category */}
                        <div className="mb-4">
                            <label className="font-semibold text-gray-700 block mb-1">Catégorie</label>
                            <select name="category" value={formData.category} onChange={handleChange} className="w-full p-2 border rounded-md">
                                <option value="Travail">Travail</option>
                                <option value="Perso">Perso</option>
                                <option value="Santé">Santé</option>
                                <option value="Étude">Étude</option>
                                <option value="Admin">Admin</option>
                            </select>
                        </div>

                        {/* Priority */}
                        <div>
                            <label className="font-semibold text-gray-700 block mb-1">Priorité</label>
                            <select name="priority" value={formData.priority} onChange={handleChange} className="w-full p-2 border rounded-md">
                                <option value="haute">Haute</option>
                                <option value="moyenne">Moyenne</option>
                                <option value="basse">Basse</option>
                            </select>
                        </div>
                    </div>

                    {/* Right Column */}
                    <div>
                        {/* Subtasks */}
                        <div className="mb-4">
                             <div className="flex justify-between items-center mb-1">
                                <strong className="font-semibold block">Sous-tâches :</strong>
                                <button onClick={handleSuggest} disabled={isSuggesting} className="text-sm text-blue-600 hover:text-blue-800 flex items-center disabled:opacity-50">
                                    {isSuggesting ? 'Génération...' : '✨ Suggérer'}
                                </button>
                            </div>
                            {formData.subtasks.map((subtask, index) => (
                                <div key={index} className="flex items-center gap-2 mb-2">
                                    <input type="text" value={subtask} onChange={(e) => handleSubtaskChange(index, e.target.value)} className="w-full p-2 border rounded-md"/>
                                    <button onClick={() => removeSubtask(index)} className="text-red-500 hover:text-red-700">X</button>
                                </div>
                            ))}
                            <button onClick={addSubtask} className="text-sm text-blue-600 hover:text-blue-800 mt-1">+ Ajouter une sous-tâche</button>
                        </div>
                        
                        {/* Notes */}
                        <div>
                            <label className="font-semibold text-gray-700 block mb-1">Notes</label>
                            <textarea name="notes" value={formData.notes} onChange={handleChange} className="w-full p-2 border rounded-md min-h-[100px]"></textarea>
                        </div>
                    </div>
                </div>

                {/* Save Button */}
                <div className="mt-6 flex justify-end">
                    <button onClick={handleSave} className="bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700">Enregistrer</button>
                </div>
            </div>
        </div>
    );
};

const AIModal = ({ isOpen, onClose, onGenerate }: { isOpen: boolean, onClose: () => void, onGenerate: (prompt: string) => Promise<void> }) => {
    const [prompt, setPrompt] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    
    const handleResult = useCallback((transcript: string) => {
        setPrompt(prev => prev ? `${prev} ${transcript}` : transcript);
    }, []);

    const { isListening, toggleListening, isSupported } = useSpeechRecognition(handleResult);

    const handleSubmit = async () => {
        if (!prompt) return;
        setIsLoading(true);
        await onGenerate(prompt);
        setIsLoading(false);
        setPrompt('');
        onClose();
    };

    if (!isOpen) return null;
    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 ai-modal" onClick={onClose}>
            <div className="bg-white rounded-lg shadow-xl w-full max-w-lg p-6 relative" onClick={e => e.stopPropagation()}>
                <h2 className="text-xl font-bold mb-4">Créer une tâche avec l'IA</h2>
                <p className="text-gray-600 mb-4 text-sm">Décrivez votre tâche en une phrase. Vous pourrez la valider avant de l'ajouter.</p>
                <textarea
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    placeholder="Ex: Réunion avec le client pour le projet X jeudi après-midi"
                    className="w-full border border-gray-300 p-2 rounded-md h-24 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    disabled={isLoading}
                />
                <div className="mt-4 flex justify-between items-center">
                    {isSupported && (
                        <button onClick={toggleListening} className={`p-2 rounded-full transition-colors ${isListening ? 'bg-red-500 text-white animate-pulse' : 'bg-gray-200 hover:bg-gray-300'}`}>
                            <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24"><path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.49 6-3.31 6-6.72h-1.7z"/></svg>
                        </button>
                    )}
                    <button onClick={handleSubmit} className="bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50" disabled={isLoading || !prompt}>
                        {isLoading ? 'Génération...' : 'Générer'}
                    </button>
                </div>
            </div>
        </div>
    );
}


const KanbanCard = ({ card, onDragStart, onClick }: { card: Card, onDragStart: (e: React.DragEvent<HTMLDivElement>) => void, onClick: () => void }) => {
    const priorityColors = {
        haute: 'border-red-500',
        moyenne: 'border-yellow-500',
        basse: 'border-green-500',
    };
    
    const categoryIcons = {
        'Travail': '💼', 'Perso': '🏠', 'Santé': '❤️', 'Étude': '🎓', 'Admin': '📄'
    };

    return (
        <div id={card.id} className={`kanban-card p-4 rounded-lg shadow-md bg-white border-l-4 ${priorityColors[card.priority]}`} draggable="true" onDragStart={onDragStart} onClick={onClick}>
            <div className="flex justify-between items-start">
                <p className="font-bold text-gray-900 pr-2">{card.title}</p>
                <span className="text-2xl">{categoryIcons[card.category]}</span>
            </div>
            <p className="text-sm text-gray-600 mt-2">
                {format(parseISO(card.datetime_start), 'HH:mm')} - {format(parseISO(card.datetime_end), 'HH:mm')}
            </p>
            {card.subtasks && card.subtasks.length > 0 && (
                 <div className="mt-3 pt-2 border-t border-gray-200">
                     <p className="text-xs text-gray-500">{card.subtasks.length} sous-tâche(s)</p>
                 </div>
            )}
        </div>
    );
};

const KanbanColumn = ({ columnName, onDragOver, onDrop, children }: { columnName: string, onDragOver: (e: React.DragEvent<HTMLDivElement>) => void, onDrop: (e: React.DragEvent<HTMLDivElement>) => void, children: React.ReactNode }) => {
    const dayDate = new Date(columnName);
    return (<div className="kanban-column-container mb-0 md:mb-0" onDragOver={onDragOver} onDrop={(e) => onDrop(e)} data-column-name={columnName}><div className="p-4 bg-gray-200 rounded-t-lg mb-4 shadow"><h3 className="font-semibold text-lg">{format(dayDate, 'eeee', { locale: fr })} <span className="font-normal text-gray-600">{format(dayDate, 'd')}</span></h3></div><div className="card-container p-2 h-full md:min-h-[100px]">{children}</div></div>);
};

const WeeklyHeader = ({ currentDate, setCurrentDate }: { currentDate: Date, setCurrentDate: (date: Date) => void }) => {
    const handlePrevWeek = () => setCurrentDate(addDays(currentDate, -7));
    const handleNextWeek = () => setCurrentDate(addDays(currentDate, 7));
    const handleToday = () => setCurrentDate(new Date());

    const start = startOfWeek(currentDate, { locale: fr });
    const end = endOfWeek(currentDate, { locale: fr });
    const formattedRange = `${format(start, 'd LLL', { locale: fr })} - ${format(end, 'd LLL yyyy', { locale: fr })}`;

    return (
        <header className="mb-8 flex flex-col sm:flex-row justify-between sm:items-center gap-4">
            <div className="flex items-center gap-4">
                <h1 className="text-2xl md:text-3xl font-bold text-gray-900">{formattedRange}</h1>
                <div className="flex gap-2">
                    <button onClick={handlePrevWeek} className="p-2 rounded-full hover:bg-gray-200">&lt;</button>
                    <button onClick={handleToday} className="px-4 py-2 text-sm font-semibold bg-gray-200 rounded-md hover:bg-gray-300">Aujourd'hui</button>
                    <button onClick={handleNextWeek} className="p-2 rounded-full hover:bg-gray-200">&gt;</button>
                </div>
            </div>
            <button onClick={() => supabase.auth.signOut()} className="bg-red-500 text-white px-4 py-2 rounded-lg hover:bg-red-600">
                Déconnexion
            </button>
        </header>
    );
};

const App = () => {
    const [session, setSession] = useState<Session | null>(null);
    const [currentDate, setCurrentDate] = useState(new Date());

    useEffect(() => {
        supabase.auth.getSession().then(({ data: { session } }) => {
            setSession(session);
        });

        const {
            data: { subscription },
        } = supabase.auth.onAuthStateChange((_event, session) => {
            setSession(session);
        });

        return () => subscription.unsubscribe();
    }, []);


    const { scheduleData, weekDays, addCard, updateCard, moveCard, findCardLocation } = useKanbanState(session, currentDate);
    const [editingCard, setEditingCard] = useState<Card | 'new' | null | Partial<Card>>(null);
    const [isAIModalOpen, setIsAIModalOpen] = useState(false);
    const [conflict, setConflict] = useState<{isOpen: boolean; onConfirm: (() => void) | null}>({ isOpen: false, onConfirm: null });
    const draggedItem = useRef<{cardId: string} | null>(null);

    const handleDragStart = (e: React.DragEvent<HTMLDivElement>, cardId: string) => { 
        draggedItem.current = { cardId }; 
        e.dataTransfer.effectAllowed = 'move'; 
        (e.target as HTMLDivElement).classList.add('dragging');
    };
    const handleDragEnd = (e: React.DragEvent<HTMLDivElement>) => { 
        (e.target as HTMLDivElement).classList.remove('dragging'); 
        draggedItem.current = null; 
    };
    const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => e.preventDefault();
    const handleDrop = (e: React.DragEvent<HTMLDivElement>, targetColumnName: string) => {
        e.preventDefault();
        if (!draggedItem.current) return;
        const { cardId } = draggedItem.current;
        moveCard(cardId, targetColumnName);
    };

    const handleSaveCard = (formData: Omit<Card, 'id' | 'user_id' | 'created_at'>, cardId?: string) => {
        const isNew = !cardId;

        if (isNew) {
            let hasConflict = false;
            const targetDayTasks = scheduleData[format(new Date(formData.datetime_start), 'yyyy-MM-dd')] || [];
            for (const card of targetDayTasks) {
                if (card.datetime_start === formData.datetime_start) {
                    hasConflict = true;
                    break;
                }
            }
            if (hasConflict) {
                setConflict({ 
                    isOpen: true, 
                    onConfirm: () => { 
                        addCard(formData); 
                        setEditingCard(null); 
                        setConflict({ isOpen: false, onConfirm: null });
                    } 
                });
            } else {
                addCard(formData);
                setEditingCard(null);
            }
        } else {
            if (typeof cardId === 'string') {
                const location = findCardLocation(cardId);
                if (location) {
                    const cardToUpdate: Card = {
                        ...location.card,
                        ...formData,
                        id: cardId,
                    };
                    updateCard(cardToUpdate);
                }
            }
            setEditingCard(null);
        }
    };

    const handleAIGenerate = async (prompt: string) => {
        try {
            const result = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: `En tant qu'assistant de projet proactif, analyse la requête suivante et génère une tâche complète. Sois créatif : suggère des sous-tâches pertinentes et ajoute des notes utiles si nécessaire. Nous sommes en 2025. Requête: "${prompt}"`,
                config: { responseMimeType: "application/json", responseSchema: cardSchema }
            });
            const cardData = JSON.parse(result.text);
            if(cardData.title && cardData.datetime_start && cardData.datetime_end && cardData.duration_min && cardData.category && cardData.priority) {
                setEditingCard({ ...cardData, subtasks: [], notes: '' }); // Initialize subtasks and notes
            } else {
                 alert("L'IA n'a pas pu générer une tâche complète. Veuillez réessayer.");
            }
        } catch (error) {
            console.error("Error generating card with AI:", error);
            alert("Une erreur est survenue lors de la communication avec l'IA. Veuillez réessayer.");
        }
    };
    
    const handleSuggestSubtasks = async (title: string): Promise<string | null> => {
        try {
            const result = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: `Pour une tâche intitulée "${title}", suggère une liste de sous-tâches claires et concises. Réponds uniquement avec les détails formatés.`,
                config: { responseMimeType: "application/json", responseSchema: subtasksSchema }
            });
            const suggestion = JSON.parse(result.text);
            return suggestion.details;
        } catch (error) {
            console.error("Error suggesting subtasks:", error);
            alert("Une erreur est survenue lors de la suggestion de sous-tâches.");
            return null;
        }
    };

    if (!session) {
        return (
            <div className="flex justify-center items-center h-screen bg-gray-100">
                <div className="w-full max-w-md p-8 bg-white shadow-lg rounded-lg">
                     <h1 className="text-2xl md:text-3xl font-bold text-gray-900 text-center mb-6">AIgenda</h1>
                    <Auth
                        supabaseClient={supabase}
                        appearance={{ theme: ThemeSupa }}
                        providers={['google', 'github']}
                        theme="light"
                        localization={{
                            variables: {
                                sign_in: {
                                    email_label: 'Adresse e-mail',
                                    password_label: 'Mot de passe',
                                    button_label: 'Se connecter',
                                    social_provider_text: 'Se connecter avec {{provider}}',
                                    link_text: 'Déjà un compte ? Connectez-vous',
                                },
                                sign_up: {
                                    email_label: 'Adresse e-mail',
                                    password_label: 'Mot de passe',
                                    button_label: 'S\'inscrire',
                                    social_provider_text: 'S\'inscrire avec {{provider}}',
                                    link_text: 'Pas de compte ? Inscrivez-vous',
                                }
                            }
                        }}
                    />
                </div>
            </div>
        )
    }

    return (
        <div className="p-4 md:p-8">
            <WeeklyHeader currentDate={currentDate} setCurrentDate={setCurrentDate} />

            <main id="kanban-board" className="kanban-board pb-4" onDragEnd={handleDragEnd}>
                {weekDays.map(day => {
                    const dayStr = format(day, 'yyyy-MM-dd');
                    const cards = scheduleData[dayStr] || [];
                    return (
                        <KanbanColumn key={dayStr} columnName={dayStr} onDragOver={handleDragOver} onDrop={(e) => handleDrop(e, dayStr)}>
                           {cards.map(card => (<KanbanCard key={card.id} card={card} onDragStart={(e) => handleDragStart(e, card.id)} onClick={() => setEditingCard(card)} />))}
                        </KanbanColumn>
                    )
                })}
            </main>
            
            <div className="fixed bottom-8 right-8 z-40 flex flex-col items-center gap-4">
                <button onClick={() => setIsAIModalOpen(true)} className="bg-blue-500 text-white w-14 h-14 rounded-full flex items-center justify-center shadow-lg hover:bg-blue-600 transition-transform transform hover:scale-110" aria-label="Créer avec l'IA">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-7 w-7" viewBox="0 0 24 24" fill="currentColor">
                        <path fillRule="evenodd" d="M9.315 7.584C12.195 3.883 16.695 1.5 21.75 1.5a.75.75 0 01.75.75c0 5.056-2.383 9.555-6.084 12.436A6.75 6.75 0 019.75 22.5a.75.75 0 01-.75-.75v-4.131A15.838 15.838 0 016.382 15H2.25a.75.75 0 01-.75-.75 6.75 6.75 0 017.815-6.666zM15 6.75a2.25 2.25 0 100 4.5 2.25 2.25 0 000-4.5z" clipRule="evenodd" />
                        <path d="M5.26 17.242a.75.75 0 10-.897-1.203 5.243 5.243 0 00-2.05 5.022.75.75 0 00.625.627 5.243 5.243 0 005.022-2.051.75.75 0 10-1.202-.897 3.744 3.744 0 01-3.006 1.511 3.744 3.744 0 01-1.51-3.006z" />
                    </svg>
                </button>
                <button onClick={() => setEditingCard('new')} className="bg-green-500 text-white w-14 h-14 rounded-full flex items-center justify-center shadow-lg hover:bg-green-600 transition-transform transform hover:scale-110" aria-label="Ajouter une nouvelle carte">
                    <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6"></path>
                    </svg>
                </button>
            </div>
            
            <AIModal isOpen={isAIModalOpen} onClose={() => setIsAIModalOpen(false)} onGenerate={handleAIGenerate} />

            {editingCard && <CardModal card={editingCard} onClose={() => setEditingCard(null)} onSave={handleSaveCard} onSuggestSubtasks={handleSuggestSubtasks} />}
            <ConfirmationModal isOpen={conflict.isOpen} onConfirm={conflict.onConfirm} onCancel={() => setConflict({ isOpen: false, onConfirm: null })} />
        </div>
    );
};

const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement);
root.render(<StrictMode><App /></StrictMode>);