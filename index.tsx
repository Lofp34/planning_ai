import React, { useState, useEffect, useCallback, useRef, StrictMode } from 'react';
import ReactDOM from 'react-dom/client';
import { GoogleGenAI, Type } from "@google/genai";
import { supabase } from './supabaseClient';
import { Auth } from '@supabase/auth-ui-react';
import { ThemeSupa } from '@supabase/auth-ui-shared';
import { Session } from '@supabase/supabase-js';
import { startOfWeek, endOfWeek, addDays, format, eachDayOfInterval } from 'date-fns';
import { fr } from 'date-fns/locale';
import './index.css';

// --- TYPES ---
interface Card {
    id: string;
    user_id: string;
    created_at: string;
    task_date: string; // Changed from 'day' to 'task_date'
    title: string;
    time: string;
    details: string;
    color: string;
    progress: number;
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


// --- CONSTANTS ---
const COLOR_PALETTE = [
    'bg-gray-200', 'bg-red-200', 'bg-yellow-200', 'bg-green-200', 
    'bg-blue-200', 'bg-indigo-200', 'bg-purple-200', 'bg-pink-200', 'bg-teal-200'
];
// --- INITIAL DATA (Example structure, now fetched from DB) ---
const initialScheduleData: ScheduleData = {
    "2025-07-28": [],
    "2025-08-04": [],
    "2025-08-11": [],
    "2025-08-18": [],
    "2025-08-25": []
};

// --- AI & LOGIC HELPERS ---
const ai = new GoogleGenAI({ apiKey: import.meta.env.VITE_GEMINI_API_KEY });

const getColumnNameForDay = (day: string): string => {
    // This function is now less relevant for main logic but can be kept for auxiliary purposes
    // Or adapted to return a week identifier if needed
    const dayDate = new Date(day);
    const weekStart = startOfWeek(dayDate, { locale: fr });
    return `Semaine du ${format(weekStart, 'd LLL', { locale: fr })}`;
};

const parseDayToDate = (dayString: string): Date => {
    // This function will need to be re-evaluated.
    // With task_date, we might not need to parse strings anymore.
    return new Date(dayString);
};

const timeToSortValue = (time: string): number => {
    switch (time) {
        case 'Toute la journée': return 0;
        case 'Matin': return 1;
        case 'Après-midi': return 2;
        default: return 3;
    }
};

const sortCards = (cards: Card[]): Card[] => {
    return [...cards].sort((a, b) => {
        const dateA = new Date(a.task_date);
        const dateB = new Date(b.task_date);
        const dateDiff = dateA.getTime() - dateB.getTime();
        if (dateDiff !== 0) return dateDiff;
        
        const timeA = timeToSortValue(a.time);
        const timeB = timeToSortValue(b.time);
        return timeA - timeB;
    });
};

const cardSchema = {
    type: Type.OBJECT,
    properties: {
        title: { type: Type.STRING, description: "Titre concis de la tâche." },
        task_date: { type: Type.STRING, description: "La date de la tâche au format AAAA-MM-JJ. Aujourd'hui est " + format(new Date(), 'yyyy-MM-dd') },
        time: { type: Type.STRING, description: "Le moment de la journée. Doit être 'Matin', 'Après-midi', ou 'Toute la journée'." },
        details: { type: Type.STRING, description: "Description de la tâche, incluant les sous-tâches si mentionnées." },
    }
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
            .gte('task_date', format(start, 'yyyy-MM-dd'))
            .lte('task_date', format(end, 'yyyy-MM-dd'));

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
                const taskDateStr = format(new Date(task.task_date), 'yyyy-MM-dd');
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


    const findCardLocation = (cardId: string) => {
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
        
        // Remove helper fields before update
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
        const { error } = await supabase
            .from('tasks')
            .update({ task_date: targetDay })
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

const Calendar = ({ initialDate, onDateSelect, onClose }: { initialDate: Date, onDateSelect: (day: Date) => void, onClose: () => void }) => {
    // ... (Component unchanged)
    const [currentDate, setCurrentDate] = useState(new Date(initialDate));
    const monthNames = ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"];
    const dayNames = ["Lu", "Ma", "Me", "Je", "Ve", "Sa", "Di"];
    const changeMonth = (offset: number) => setCurrentDate(prev => { const d = new Date(prev); d.setMonth(d.getMonth() + offset); return d; });
    const renderGrid = () => {
        const year = currentDate.getFullYear(), month = currentDate.getMonth();
        const firstDayOfMonth = new Date(year, month, 1).getDay(), daysInMonth = new Date(year, month + 1, 0).getDate();
        const startOffset = (firstDayOfMonth === 0) ? 6 : firstDayOfMonth - 1;
        const cells = [];
        for (let i = 0; i < startOffset; i++) { cells.push(<div key={`e-${i}`}></div>); }
        for (let day = 1; day <= daysInMonth; day++) {
            cells.push(<div key={day} className="calendar-cell day" onClick={(e) => { e.stopPropagation(); onDateSelect(new Date(year, month, day)); onClose(); }}>{day}</div>);
        }
        return cells;
    };
    const calendarRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => { if (calendarRef.current && !calendarRef.current.contains(event.target as Node) && (event.target as HTMLElement).id !== 'modal-edit-day') { onClose(); } };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [onClose]);
    return (<div id="calendar-wrapper" ref={calendarRef}><div id="calendar-header"><button onClick={(e) => {e.stopPropagation(); changeMonth(-1)}} className="p-1 rounded-full hover:bg-gray-200">&lt;</button><span className="font-bold">{monthNames[currentDate.getMonth()]} {currentDate.getFullYear()}</span><button onClick={(e) => {e.stopPropagation(); changeMonth(1)}} className="p-1 rounded-full hover:bg-gray-200">&gt;</button></div><div id="calendar-grid">{dayNames.map(d => <div key={d} className="calendar-cell day-name">{d}</div>)}{renderGrid()}</div></div>);
};

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


const CardModal = ({ card, scheduleData, onClose, onSave, onSuggestSubtasks }: { card: Card | 'new' | Partial<Card>, scheduleData: ScheduleData, onClose: () => void, onSave: (formData: any, cardId?: string) => void, onSuggestSubtasks: (title: string) => Promise<string | null> }) => {
    const isNew = card === 'new' || !(card as Card).id;
    const [formData, setFormData] = useState({
        title: isNew ? (card as Partial<Card>)?.title || '' : (card as Card).title,
        task_date: isNew ? (card as Partial<Card>)?.task_date || format(new Date(), 'yyyy-MM-dd') : (card as Card).task_date,
        time: isNew ? (card as Partial<Card>)?.time || 'Matin' : (card as Card).time,
        details: isNew ? (card as Partial<Card>)?.details || '' : (card as Card).details,
        color: isNew ? (card as Partial<Card>)?.color || 'bg-teal-200' : (card as Card).color,
        progress: isNew ? (card as Partial<Card>)?.progress || 0 : (card as Card).progress,
    });
    const [showCalendar, setShowCalendar] = useState(false);
    const [isSuggesting, setIsSuggesting] = useState(false);
    
    useEffect(() => {
        if (!isNew) {
            setFormData({
                title: (card as Card).title, task_date: (card as Card).task_date, time: (card as Card).time,
                details: (card as Card).details, color: (card as Card).color, progress: (card as Card).progress
            });
        }
    }, [card]);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setFormData(prev => ({ ...prev, [e.target.name]: e.target.value }));
    const handleDetailsChange = (e: React.FocusEvent<HTMLDivElement>) => setFormData(prev => ({...prev, details: e.currentTarget.textContent || ''}));
    const handleDateSelect = (day: Date) => setFormData(prev => ({...prev, task_date: format(day, 'yyyy-MM-dd')}));
    const handleColorChange = (color: string) => setFormData(prev => ({ ...prev, color }));
    const handleProgressChange = (value: number) => setFormData(prev => ({ ...prev, progress: value }));

    const handleSuggest = async () => {
        setIsSuggesting(true);
        const suggestion = await onSuggestSubtasks(formData.title);
        if (suggestion) {
            setFormData(prev => ({...prev, details: suggestion}));
        }
        setIsSuggesting(false);
    };

    const handleSave = () => {
        if (!formData.title) return alert("Le titre est obligatoire.");
        if (!formData.task_date) return alert("Veuillez choisir une date.");
        onSave(formData, (card as Card)?.id);
    };
    
    const initialDate = () => {
        return new Date(formData.task_date);
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 modal-backdrop" onClick={onClose}>
            <div className="bg-white rounded-lg shadow-xl w-full max-w-lg p-6 relative" onClick={e => e.stopPropagation()}>
                <button onClick={onClose} className="absolute top-4 right-4 text-gray-500 hover:text-gray-800">
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path>
                    </svg>
                </button>
                <div className="mb-4">
                     <input type="text" name="title" value={formData.title} onChange={handleChange} placeholder="Titre de la nouvelle carte" className="text-2xl font-bold w-full border-b-2 border-gray-300 focus:border-blue-500 outline-none pb-2" />
                </div>
                <div className="text-gray-700 space-y-4">
                    <div className="relative">
                        <strong className="font-semibold">Date :</strong>
                        <button id="modal-edit-day" onClick={() => setShowCalendar(s => !s)} className="ml-2 p-2 border rounded-md hover:bg-gray-100">{format(new Date(formData.task_date), 'eeee d MMMM', { locale: fr })}</button>
                        {showCalendar && <Calendar initialDate={initialDate()} onDateSelect={handleDateSelect} onClose={() => setShowCalendar(false)} />}
                    </div>
                     <div>
                        <strong className="font-semibold">Moment :</strong>
                        <select name="time" value={formData.time} onChange={handleChange} className="ml-2 p-2 border rounded-md"><option value="Matin">Matin</option><option value="Après-midi">Après-midi</option><option value="Toute la journée">Toute la journée</option></select>
                    </div>
                    <div>
                        <div className="flex justify-between items-center mb-1">
                            <strong className="font-semibold block">Détails :</strong>
                            <button onClick={handleSuggest} disabled={isSuggesting} className="text-sm text-blue-600 hover:text-blue-800 flex items-center disabled:opacity-50">
                                {isSuggesting ? 'Génération...' : '✨ Suggérer des sous-tâches'}
                            </button>
                        </div>
                        <div onBlur={handleDetailsChange} contentEditable="true" suppressContentEditableWarning={true} className="w-full border border-gray-200 p-2 rounded-md min-h-[80px] focus:outline-none focus:ring-2 focus:ring-blue-500" dangerouslySetInnerHTML={{__html: formData.details}}></div>
                    </div>
                    <div>
                        <strong className="font-semibold block mb-2">Progression : {formData.progress}%</strong>
                        <div className="flex items-center gap-3"><button onClick={() => handleProgressChange(Math.max(0, formData.progress - 10))} className="p-1 rounded-full bg-gray-200 hover:bg-gray-300">-</button><input type="range" min="0" max="100" step="10" value={formData.progress} onChange={(e) => handleProgressChange(parseInt(e.target.value))} className="w-full h-2 bg-gray-300 rounded-lg appearance-none cursor-pointer" /><button onClick={() => handleProgressChange(Math.min(100, formData.progress + 10))} className="p-1 rounded-full bg-gray-200 hover:bg-gray-300">+</button></div>
                    </div>
                     <div><strong className="font-semibold block mb-2">Couleur :</strong><div className="flex flex-wrap gap-2">{COLOR_PALETTE.map(color => (<button key={color} type="button" onClick={() => handleColorChange(color)} className={`w-8 h-8 rounded-full transition-transform transform hover:scale-110 ${color} ${formData.color === color ? 'ring-2 ring-offset-2 ring-blue-500' : ''}`} />))}</div></div>
                </div>
                <div className="mt-6 flex justify-end"><button onClick={handleSave} className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700">Enregistrer</button></div>
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


const KanbanCard = ({ card, onDragStart, onClick, onUpdateCard }: { card: Card, onDragStart: (e: React.DragEvent<HTMLDivElement>) => void, onClick: () => void, onUpdateCard: (card: Card) => void }) => {
    const handleProgressClick = (e: React.MouseEvent<HTMLDivElement>) => { e.stopPropagation(); onUpdateCard({ ...card, progress: card.progress >= 100 ? 0 : card.progress + 10 }); };
    return (<div id={card.id} className={`kanban-card p-4 rounded-lg shadow-md ${card.color}`} draggable="true" onDragStart={onDragStart} onClick={onClick}><p className="font-bold text-gray-900">{card.title}</p><p className="text-sm text-gray-700 mt-1">{format(new Date(card.task_date), 'd LLL', { locale: fr })} - {card.time}</p><div className="mt-3 pt-2 border-t border-gray-500 border-opacity-20 cursor-pointer" onClick={handleProgressClick}><div className="flex justify-between items-center text-xs text-gray-700"><span>Progression</span><span className="font-semibold">{card.progress}%</span></div><div className="w-full bg-gray-300 bg-opacity-50 rounded-full h-1.5 mt-1"><div className={`h-1.5 rounded-full ${card.color.replace('200', '500')}`} style={{ width: `${card.progress}%` }}></div></div></div></div>);
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
    const getDragAfterElement = (container: HTMLDivElement, y: number): Element | undefined => {
        const draggableElements = [...container.querySelectorAll('.kanban-card:not(.dragging)')];
        const initial: { offset: number, element?: Element } = { offset: Number.NEGATIVE_INFINITY };
        return draggableElements.reduce((closest, child) => {
            const box = child.getBoundingClientRect();
            const offset = y - box.top - box.height / 2;
            if (offset < 0 && offset > closest.offset) {
                return { offset: offset, element: child };
            }
            return closest;
        }, initial).element;
    };
    const handleDrop = (e: React.DragEvent<HTMLDivElement>, targetColumnName: string) => {
        e.preventDefault();
        if (!draggedItem.current) return;
        const { cardId } = draggedItem.current;
        moveCard(cardId, targetColumnName);
    };

    const handleSaveCard = (formData: Omit<Card, 'id' | 'user_id' | 'created_at'>, cardId?: string) => {
        const isNew = !cardId;
        
        const cardData = { ...formData };

        const performSave = () => {
            if (isNew) {
                addCard(cardData);
            } else if (cardId) {
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
            setConflict({ isOpen: false, onConfirm: null });
        };

        if (isNew) { 
            let hasConflict = false;
            // Simplified conflict check - check if any card exists at the same date and time
            const targetDayTasks = scheduleData[format(new Date(formData.task_date), 'yyyy-MM-dd')] || [];
            for (const card of targetDayTasks) {
                if (card.time === 'Toute la journée' || formData.time === 'Toute la journée' || card.time === formData.time) {
                    hasConflict = true; break;
                }
            }
            if (hasConflict) setConflict({ isOpen: true, onConfirm: () => performSave() });
            else performSave();
        } else {
            performSave();
        }
    };

    const handleAIGenerate = async (prompt: string) => {
        try {
            const result = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: `A partir de la requête utilisateur, extrais les informations pour créer une tâche. Nous sommes en 2025. Réponds uniquement avec le JSON. Requête: "${prompt}"`,
                config: { responseMimeType: "application/json", responseSchema: cardSchema }
            });
            const cardData = JSON.parse(result.text);
            if(cardData.title && cardData.task_date && cardData.time) {
                setEditingCard({ ...cardData, color: 'bg-teal-200', progress: 0 });
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
                           {cards.map(card => (<KanbanCard key={card.id} card={card} onDragStart={(e) => handleDragStart(e, card.id)} onClick={() => setEditingCard(card)} onUpdateCard={updateCard} />))}
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

            {editingCard && <CardModal card={editingCard} scheduleData={scheduleData} onClose={() => setEditingCard(null)} onSave={handleSaveCard} onSuggestSubtasks={handleSuggestSubtasks} />}
            <ConfirmationModal isOpen={conflict.isOpen} onConfirm={conflict.onConfirm} onCancel={() => setConflict({ isOpen: false, onConfirm: null })} />
        </div>
    );
};

const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement);
root.render(<StrictMode><App /></StrictMode>);
root.render(<StrictMode><App /></StrictMode>);