import React, { useState, useEffect, useCallback, useRef, StrictMode } from 'react';
import ReactDOM from 'react-dom/client';
import { GoogleGenAI, Type } from "@google/genai";
import './index.css';

// --- TYPES ---
interface Card {
    id: string;
    day: string;
    title: string;
    time: string;
    details: string;
    color: string;
    progress: number;
}

interface ScheduleData {
    [columnName: string]: Card[];
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
// --- INITIAL DATA ---
const initialScheduleData: ScheduleData = {
    "Semaine 0 (28 Juil - 1 Août): Anticipation": [
        { id: "s0-t1", day: "Lundi 28", title: "Préparer la Semaine 1", time: "Matin", details: "Vérifier les objectifs du bootcamp, lister les pré-requis.", color: "bg-gray-200", progress: 0 },
    ],
    "Semaine 1 (4-8 Août): Socle Commercial": [
        { id: "s1-t1", day: "Lundi 4", title: "Stratégie Bootcamp", time: "Matin", details: "Gantt, Chiffrage, Cible, Stratégie de vente", color: "bg-blue-200", progress: 0 },
    ],
    "Semaine 2 (11-15 Août): Montée en Compétence IA": [
        { id: "s2-t1", day: "Lundi 11", title: "Formation RAG", time: "Matin", details: "Concepts, Architecture, POC sur mes docs", color: "bg-red-200", progress: 0 },
    ],
    "Semaine 3 (18-22 Août): Développement Projets Clients": [
        { id: "s3-t1", day: "Lundi 18", title: "Projet Sébastien V1", time: "Matin", details: "Deviseur 3D", color: "bg-cyan-200", progress: 0 },
    ],
    "Semaine 4 (25-29 Août): Production & Bilan": [
        { id: "s4-t1", day: "Lundi 25", title: "Production Contenu", time: "Matin", details: "Rédaction, Enregistrement", color: "bg-pink-200", progress: 0 },
    ]
};

// --- AI & LOGIC HELPERS ---
const ai = new GoogleGenAI({ apiKey: import.meta.env.VITE_GEMINI_API_KEY });

const getColumnNameForDay = (day: string): string => {
    const dayNumber = parseInt(day.split(' ')[1]);
    if (isNaN(dayNumber)) return Object.keys(initialScheduleData)[0]; // Fallback

    if (dayNumber >= 28 || dayNumber === 1) return "Semaine 0 (28 Juil - 1 Août): Anticipation";
    if (dayNumber >= 4 && dayNumber <= 8) return "Semaine 1 (4-8 Août): Socle Commercial";
    if (dayNumber >= 11 && dayNumber <= 15) return "Semaine 2 (11-15 Août): Montée en Compétence IA";
    if (dayNumber >= 18 && dayNumber <= 22) return "Semaine 3 (18-22 Août): Développement Projets Clients";
    if (dayNumber >= 25 && dayNumber <= 29) return "Semaine 4 (25-29 Août): Production & Bilan";
    
    return Object.keys(initialScheduleData)[0]; // Default fallback
};

const parseDayToDate = (dayString: string): Date => {
    const dayNumber = parseInt(dayString.split(' ')[1]);
    const month = dayNumber >= 28 ? 6 : 7; 
    return new Date(2025, month, dayNumber);
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
        const dateA = parseDayToDate(a.day);
        const dateB = parseDayToDate(b.day);
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
        day: { type: Type.STRING, description: "Le jour et le numéro du mois, ex: 'Lundi 4', 'Mardi 29'. Le mois est Août 2025 (sauf pour fin Juillet)." },
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
const useKanbanState = () => {
    const [scheduleData, setScheduleData] = useState<ScheduleData>(() => {
        try {
            const savedData = localStorage.getItem('kanbanPlanningData');
            return savedData ? JSON.parse(savedData) : JSON.parse(JSON.stringify(initialScheduleData));
        } catch (e) {
            return JSON.parse(JSON.stringify(initialScheduleData));
        }
    });

    useEffect(() => {
        localStorage.setItem('kanbanPlanningData', JSON.stringify(scheduleData));
    }, [scheduleData]);

    const findCardLocation = (cardId: string) => {
        for (const columnName in scheduleData) {
            const cardIndex = scheduleData[columnName].findIndex(c => c.id === cardId);
            if (cardIndex > -1) return { columnName, cardIndex, card: scheduleData[columnName][cardIndex] };
        }
        return null;
    };

    const addCard = (card: Card) => {
        setScheduleData(prevData => {
            const newData = { ...prevData };
            const targetColumnName = getColumnNameForDay(card.day);
            const columnCards = [...(newData[targetColumnName] || []), card];
            newData[targetColumnName] = sortCards(columnCards);
            return newData;
        });
    };

    const updateCard = (updatedCard: Card) => {
        setScheduleData(prevData => {
            const newData = { ...prevData };
            for (const colName in newData) {
                const cardIndex = newData[colName].findIndex(c => c.id === updatedCard.id);
                if (cardIndex !== -1) { newData[colName].splice(cardIndex, 1); break; }
            }
            const targetColumnName = getColumnNameForDay(updatedCard.day);
            const columnCards = [...(newData[targetColumnName] || []), updatedCard];
            newData[targetColumnName] = sortCards(columnCards);
            return newData;
        });
    };
    
    const moveCard = (cardId: string, targetColumnName: string, targetIndex: number | null) => {
        const sourceLocation = findCardLocation(cardId);
        if (!sourceLocation) return;
        const { card, columnName: sourceColumnName, cardIndex: sourceCardIndex } = sourceLocation;
        setScheduleData(prevData => {
            const newData = { ...prevData };
            const sourceColumn = [...newData[sourceColumnName]];
            sourceColumn.splice(sourceCardIndex, 1);
            newData[sourceColumnName] = sourceColumn;
            
            const targetColumn = [...(newData[targetColumnName] || [])];
            const finalIndex = targetIndex === null ? targetColumn.length : targetIndex;
            targetColumn.splice(finalIndex, 0, card);
            newData[targetColumnName] = targetColumn;
            return newData;
        });
    };

    return { scheduleData, addCard, updateCard, moveCard, findCardLocation };
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

const Calendar = ({ initialDate, onDateSelect, onClose }) => {
    // ... (Component unchanged)
    const [currentDate, setCurrentDate] = useState(new Date(initialDate));
    const monthNames = ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"];
    const dayNames = ["Lu", "Ma", "Me", "Je", "Ve", "Sa", "Di"];
    const changeMonth = (offset) => setCurrentDate(prev => { const d = new Date(prev); d.setMonth(d.getMonth() + offset); return d; });
    const renderGrid = () => {
        const year = currentDate.getFullYear(), month = currentDate.getMonth();
        const firstDayOfMonth = new Date(year, month, 1).getDay(), daysInMonth = new Date(year, month + 1, 0).getDate();
        const startOffset = (firstDayOfMonth === 0) ? 6 : firstDayOfMonth - 1;
        const cells = [];
        for (let i = 0; i < startOffset; i++) { cells.push(<div key={`e-${i}`}></div>); }
        for (let day = 1; day <= daysInMonth; day++) {
            cells.push(<div key={day} className="calendar-cell day" onClick={(e) => { e.stopPropagation(); const d = new Date(year, month, day); onDateSelect(`${dayNames[(d.getDay() === 0) ? 6 : d.getDay() - 1]} ${day}`); onClose(); }}>{day}</div>);
        }
        return cells;
    };
    const calendarRef = useRef(null);
    useEffect(() => {
        const handleClickOutside = (event) => { if (calendarRef.current && !calendarRef.current.contains(event.target) && event.target.id !== 'modal-edit-day') { onClose(); } };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [onClose]);
    return (<div id="calendar-wrapper" ref={calendarRef}><div id="calendar-header"><button onClick={(e) => {e.stopPropagation(); changeMonth(-1)}} className="p-1 rounded-full hover:bg-gray-200">&lt;</button><span className="font-bold">{monthNames[currentDate.getMonth()]} {currentDate.getFullYear()}</span><button onClick={(e) => {e.stopPropagation(); changeMonth(1)}} className="p-1 rounded-full hover:bg-gray-200">&gt;</button></div><div id="calendar-grid">{dayNames.map(d => <div key={d} className="calendar-cell day-name">{d}</div>)}{renderGrid()}</div></div>);
};

const ConfirmationModal = ({ isOpen, onConfirm, onCancel }) => {
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
                    <button onClick={onConfirm} className="px-4 py-2 bg-yellow-500 text-white text-base font-medium rounded-md w-auto hover:bg-yellow-600">Valider quand même</button>
                    <button onClick={onCancel} className="px-4 py-2 bg-gray-200 text-gray-800 text-base font-medium rounded-md w-auto hover:bg-gray-300">Choisir une autre date</button>
                </div>
            </div>
        </div>
    );
};


const CardModal = ({ card, scheduleData, onClose, onSave, onSuggestSubtasks }) => {
    const isNew = card === 'new' || !card.id;
    const [formData, setFormData] = useState({
        title: isNew ? card?.title || '' : card.title,
        day: isNew ? card?.day || 'Choisir une date' : card.day,
        time: isNew ? card?.time || 'Matin' : card.time,
        details: isNew ? card?.details || '' : card.details,
        color: isNew ? card?.color || 'bg-teal-200' : card.color,
        progress: isNew ? card?.progress || 0 : card.progress,
    });
    const [showCalendar, setShowCalendar] = useState(false);
    const [isSuggesting, setIsSuggesting] = useState(false);
    
    useEffect(() => {
        if (!isNew) {
            setFormData({
                title: card.title, day: card.day, time: card.time,
                details: card.details, color: card.color, progress: card.progress
            });
        }
    }, [card]);

    const handleChange = (e) => setFormData(prev => ({ ...prev, [e.target.name]: e.target.value }));
    const handleDetailsChange = (e) => setFormData(prev => ({...prev, details: e.currentTarget.textContent}));
    const handleDateSelect = (day) => setFormData(prev => ({...prev, day}));
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
        if (formData.day === 'Choisir une date') return alert("Veuillez choisir une date.");
        onSave(formData, card?.id);
    };
    
    const initialDate = () => {
        if (!formData.day || formData.day === 'Choisir une date') return new Date(2025, 7, 1);
        const dayNumber = parseInt(formData.day.split(' ')[1]);
        return new Date(2025, dayNumber >= 28 ? 6 : 7, dayNumber);
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
                        <strong className="font-semibold">Jour :</strong>
                        <button id="modal-edit-day" onClick={() => setShowCalendar(s => !s)} className="ml-2 p-2 border rounded-md hover:bg-gray-100">{formData.day}</button>
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

const AIModal = ({ isOpen, onClose, onGenerate }) => {
    const [prompt, setPrompt] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    
    const handleResult = useCallback((transcript) => {
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


const KanbanCard = ({ card, onDragStart, onClick, onUpdateCard }) => {
    const handleProgressClick = (e) => { e.stopPropagation(); onUpdateCard({ ...card, progress: card.progress >= 100 ? 0 : card.progress + 10 }); };
    return (<div id={card.id} className={`kanban-card p-4 rounded-lg shadow-md ${card.color}`} draggable="true" onDragStart={onDragStart} onClick={onClick}><p className="font-bold text-gray-900">{card.title}</p><p className="text-sm text-gray-700 mt-1">{card.day} - {card.time}</p><div className="mt-3 pt-2 border-t border-gray-500 border-opacity-20 cursor-pointer" onClick={handleProgressClick}><div className="flex justify-between items-center text-xs text-gray-700"><span>Progression</span><span className="font-semibold">{card.progress}%</span></div><div className="w-full bg-gray-300 bg-opacity-50 rounded-full h-1.5 mt-1"><div className={`h-1.5 rounded-full ${card.color.replace('200', '500')}`} style={{ width: `${card.progress}%` }}></div></div></div></div>);
};

const KanbanColumn = ({ columnName, onDragOver, onDrop, children }) => {
    return (<div className="kanban-column-container mb-0 md:mb-0" onDragOver={onDragOver} onDrop={onDrop} data-column-name={columnName}><div className="p-4 bg-gray-200 rounded-t-lg mb-4 shadow"><h3 className="font-semibold text-lg">{columnName}</h3></div><div className="card-container p-2 h-full md:min-h-[100px]">{children}</div></div>);
};

const App = () => {
    const { scheduleData, addCard, updateCard, moveCard, findCardLocation } = useKanbanState();
    const [editingCard, setEditingCard] = useState<Card | 'new' | null | Partial<Card>>(null);
    const [isAIModalOpen, setIsAIModalOpen] = useState(false);
    const [conflict, setConflict] = useState<{isOpen: boolean; onConfirm: (() => void) | null}>({ isOpen: false, onConfirm: null });
    const draggedItem = useRef<{cardId: string} | null>(null);

    const handleDragStart = (e, cardId) => { draggedItem.current = { cardId }; e.dataTransfer.effectAllowed = 'move'; setTimeout(() => e.currentTarget.classList.add('dragging'), 0); };
    const handleDragEnd = (e) => { e.target.classList.remove('dragging'); draggedItem.current = null; };
    const handleDragOver = (e) => e.preventDefault();
    const getDragAfterElement = (container, y) => {
        const draggableElements = [...container.querySelectorAll('.kanban-card:not(.dragging)')];
        return draggableElements.reduce((closest, child) => {
            const box = child.getBoundingClientRect();
            const offset = y - box.top - box.height / 2;
            if (offset < 0 && offset > closest.offset) return { offset: offset, element: child };
            return closest;
        }, { offset: Number.NEGATIVE_INFINITY }).element;
    };
    const handleDrop = (e, targetColumnName) => {
        e.preventDefault();
        if (!draggedItem.current) return;
        const { cardId } = draggedItem.current;
        const afterElement = getDragAfterElement(e.currentTarget, e.clientY);
        const location = findCardLocation(afterElement?.id);
        moveCard(cardId, targetColumnName, location ? location.cardIndex : null);
    };

    const handleSaveCard = (formData, cardId) => {
        const isNew = !cardId;
        const currentCardId = isNew ? `card-${Date.now()}` : cardId;
        
        const newCardData: Card = { ...formData, id: currentCardId };

        let hasConflict = false;
        for (const colName in scheduleData) {
            for (const card of scheduleData[colName]) {
                if (card.id === currentCardId) continue;
                if (card.day === newCardData.day && (card.time === 'Toute la journée' || newCardData.time === 'Toute la journée' || card.time === newCardData.time)) {
                    hasConflict = true; break;
                }
            }
            if (hasConflict) break;
        }

        const performSave = () => {
            if (isNew) addCard(newCardData);
            else updateCard(newCardData);
            setEditingCard(null);
            setConflict({ isOpen: false, onConfirm: null });
        };

        if (hasConflict) setConflict({ isOpen: true, onConfirm: () => performSave() });
        else performSave();
    };

    const handleAIGenerate = async (prompt: string) => {
        try {
            const result = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: `A partir de la requête utilisateur, extrais les informations pour créer une tâche. Nous sommes en 2025. Réponds uniquement avec le JSON. Requête: "${prompt}"`,
                config: { responseMimeType: "application/json", responseSchema: cardSchema }
            });
            const cardData = JSON.parse(result.text);
            setEditingCard({ ...cardData });
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

    return (
        <div className="p-4 md:p-8">
            <header className="mb-8 flex flex-col sm:flex-row justify-between sm:items-center gap-4">
                 <div>
                    <h1 className="text-2xl md:text-3xl font-bold text-gray-900">Planning d'Août</h1>
                    <p className="text-sm md:text-base text-gray-600 mt-1">Les modifications sont sauvegardées automatiquement.</p>
                </div>
            </header>

            <main id="kanban-board" className="kanban-board pb-4" onDragEnd={handleDragEnd}>
                {Object.entries(scheduleData).map(([columnName, cards]) => (
                    <KanbanColumn key={columnName} columnName={columnName} onDragOver={handleDragOver} onDrop={(e) => handleDrop(e, columnName)}>
                       {cards.map(card => (<KanbanCard key={card.id} card={card} onDragStart={(e) => handleDragStart(e, card.id)} onClick={() => setEditingCard(card)} onUpdateCard={updateCard} />))}
                    </KanbanColumn>
                ))}
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