// GENERE PAR store/build-privacy.mjs — NE PAS EDITER A LA MAIN.
// La source est privacy-policy*.md a la racine du depot.
// Relancer :  node store/build-privacy.mjs

export type PolicyBlock =
  | { type: 'p'; text: string }
  | { type: 'ul'; items: string[] }

export interface Policy {
  label: string
  title: string
  updated: string
  sections: { heading: string; blocks: PolicyBlock[] }[]
}

export const PRIVACY_LANGS = ["fr","en","es","de","it"] as const
export type PolicyLang = (typeof PRIVACY_LANGS)[number]

export const PRIVACY: Record<PolicyLang, Policy> = {
  "fr": {
    "label": "Français",
    "title": "Politique de confidentialité — SplitIt",
    "updated": "Dernière mise à jour : 18 juin 2026",
    "sections": [
      {
        "heading": "1. Données collectées",
        "blocks": [
          {
            "type": "p",
            "text": "SplitIt collecte uniquement les données nécessaires au fonctionnement de l'application :"
          },
          {
            "type": "ul",
            "items": [
              "**Adresse email et nom d'utilisateur** — pour créer et identifier votre compte",
              "**Dépenses et groupes** — les montants, descriptions et répartitions que vous saisissez",
              "**Photos de tickets** — uniquement si vous choisissez d'en uploader une"
            ]
          }
        ]
      },
      {
        "heading": "2. Utilisation des données",
        "blocks": [
          {
            "type": "p",
            "text": "Vos données sont utilisées exclusivement pour :"
          },
          {
            "type": "ul",
            "items": [
              "Vous permettre de vous connecter à votre compte",
              "Afficher et partager vos dépenses avec les membres de vos groupes",
              "Améliorer la précision de la reconnaissance OCR (de manière anonyme)"
            ]
          }
        ]
      },
      {
        "heading": "3. Partage des données",
        "blocks": [
          {
            "type": "p",
            "text": "Nous ne vendons, ne louons et ne partageons jamais vos données personnelles avec des tiers à des fins commerciales."
          },
          {
            "type": "p",
            "text": "Les données sont stockées sur des serveurs sécurisés (Supabase / AWS EU)."
          }
        ]
      },
      {
        "heading": "4. Conservation des données",
        "blocks": [
          {
            "type": "p",
            "text": "Vos données sont conservées tant que votre compte est actif. Vous pouvez demander la suppression de votre compte à tout moment depuis l'application (Réglages → Supprimer mon compte)."
          }
        ]
      },
      {
        "heading": "5. Sécurité",
        "blocks": [
          {
            "type": "p",
            "text": "Les mots de passe sont chiffrés (bcrypt). Les communications sont chiffrées via HTTPS."
          }
        ]
      },
      {
        "heading": "6. Contact",
        "blocks": [
          {
            "type": "p",
            "text": "Pour toute question : **ares88775@gmail.com**"
          }
        ]
      }
    ]
  },
  "en": {
    "label": "English",
    "title": "Privacy Policy — SplitIt",
    "updated": "Last updated: 18 June 2026",
    "sections": [
      {
        "heading": "1. Data we collect",
        "blocks": [
          {
            "type": "p",
            "text": "SplitIt only collects the data the app needs to work:"
          },
          {
            "type": "ul",
            "items": [
              "**Email address and username** — to create and identify your account",
              "**Expenses and groups** — the amounts, descriptions and splits you enter",
              "**Receipt photos** — only if you choose to upload one"
            ]
          }
        ]
      },
      {
        "heading": "2. How we use your data",
        "blocks": [
          {
            "type": "p",
            "text": "Your data is used solely to:"
          },
          {
            "type": "ul",
            "items": [
              "Let you sign in to your account",
              "Display and share your expenses with the members of your groups",
              "Improve the accuracy of receipt recognition (anonymously)"
            ]
          }
        ]
      },
      {
        "heading": "3. Sharing your data",
        "blocks": [
          {
            "type": "p",
            "text": "We never sell, rent or share your personal data with third parties for commercial purposes."
          },
          {
            "type": "p",
            "text": "Data is stored on secure servers (Supabase / AWS EU)."
          }
        ]
      },
      {
        "heading": "4. Data retention",
        "blocks": [
          {
            "type": "p",
            "text": "Your data is kept for as long as your account is active. You can request deletion of your account at any time from within the app (Settings → Delete my account)."
          }
        ]
      },
      {
        "heading": "5. Security",
        "blocks": [
          {
            "type": "p",
            "text": "Passwords are hashed (bcrypt). Communications are encrypted over HTTPS."
          }
        ]
      },
      {
        "heading": "6. Contact",
        "blocks": [
          {
            "type": "p",
            "text": "Any questions: **ares88775@gmail.com**"
          }
        ]
      }
    ]
  },
  "es": {
    "label": "Español",
    "title": "Política de privacidad — SplitIt",
    "updated": "Última actualización: 18 de junio de 2026",
    "sections": [
      {
        "heading": "1. Datos recogidos",
        "blocks": [
          {
            "type": "p",
            "text": "SplitIt solo recoge los datos necesarios para el funcionamiento de la aplicación:"
          },
          {
            "type": "ul",
            "items": [
              "**Dirección de correo y nombre de usuario** — para crear e identificar tu cuenta",
              "**Gastos y grupos** — los importes, descripciones y repartos que introduces",
              "**Fotos de tickets** — únicamente si decides subir alguna"
            ]
          }
        ]
      },
      {
        "heading": "2. Uso de los datos",
        "blocks": [
          {
            "type": "p",
            "text": "Tus datos se utilizan exclusivamente para:"
          },
          {
            "type": "ul",
            "items": [
              "Permitirte iniciar sesión en tu cuenta",
              "Mostrar y compartir tus gastos con los miembros de tus grupos",
              "Mejorar la precisión del reconocimiento de tickets (de forma anónima)"
            ]
          }
        ]
      },
      {
        "heading": "3. Comunicación de los datos",
        "blocks": [
          {
            "type": "p",
            "text": "Nunca vendemos, alquilamos ni compartimos tus datos personales con terceros con fines comerciales."
          },
          {
            "type": "p",
            "text": "Los datos se almacenan en servidores seguros (Supabase / AWS UE)."
          }
        ]
      },
      {
        "heading": "4. Conservación de los datos",
        "blocks": [
          {
            "type": "p",
            "text": "Tus datos se conservan mientras tu cuenta esté activa. Puedes solicitar la eliminación de tu cuenta en cualquier momento desde la aplicación (Ajustes → Eliminar mi cuenta)."
          }
        ]
      },
      {
        "heading": "5. Seguridad",
        "blocks": [
          {
            "type": "p",
            "text": "Las contraseñas se cifran (bcrypt). Las comunicaciones se cifran mediante HTTPS."
          }
        ]
      },
      {
        "heading": "6. Contacto",
        "blocks": [
          {
            "type": "p",
            "text": "Para cualquier pregunta: **ares88775@gmail.com**"
          }
        ]
      }
    ]
  },
  "de": {
    "label": "Deutsch",
    "title": "Datenschutzerklärung — SplitIt",
    "updated": "Zuletzt aktualisiert: 18. Juni 2026",
    "sections": [
      {
        "heading": "1. Erhobene Daten",
        "blocks": [
          {
            "type": "p",
            "text": "SplitIt erhebt ausschließlich die Daten, die für den Betrieb der App erforderlich sind:"
          },
          {
            "type": "ul",
            "items": [
              "**E-Mail-Adresse und Benutzername** — um dein Konto anzulegen und zu identifizieren",
              "**Ausgaben und Gruppen** — die Beträge, Beschreibungen und Aufteilungen, die du eingibst",
              "**Belegfotos** — nur wenn du dich entscheidest, eines hochzuladen"
            ]
          }
        ]
      },
      {
        "heading": "2. Verwendung der Daten",
        "blocks": [
          {
            "type": "p",
            "text": "Deine Daten werden ausschließlich verwendet, um:"
          },
          {
            "type": "ul",
            "items": [
              "dir die Anmeldung an deinem Konto zu ermöglichen",
              "deine Ausgaben den Mitgliedern deiner Gruppen anzuzeigen und mit ihnen zu teilen",
              "die Genauigkeit der Belegerkennung zu verbessern (anonymisiert)"
            ]
          }
        ]
      },
      {
        "heading": "3. Weitergabe der Daten",
        "blocks": [
          {
            "type": "p",
            "text": "Wir verkaufen, vermieten oder teilen deine personenbezogenen Daten niemals zu kommerziellen Zwecken an Dritte."
          },
          {
            "type": "p",
            "text": "Die Daten werden auf sicheren Servern gespeichert (Supabase / AWS EU)."
          }
        ]
      },
      {
        "heading": "4. Speicherdauer",
        "blocks": [
          {
            "type": "p",
            "text": "Deine Daten werden gespeichert, solange dein Konto aktiv ist. Du kannst die Löschung deines Kontos jederzeit in der App beantragen (Einstellungen → Konto löschen)."
          }
        ]
      },
      {
        "heading": "5. Sicherheit",
        "blocks": [
          {
            "type": "p",
            "text": "Passwörter werden gehasht (bcrypt). Die Kommunikation ist über HTTPS verschlüsselt."
          }
        ]
      },
      {
        "heading": "6. Kontakt",
        "blocks": [
          {
            "type": "p",
            "text": "Bei Fragen: **ares88775@gmail.com**"
          }
        ]
      }
    ]
  },
  "it": {
    "label": "Italiano",
    "title": "Informativa sulla privacy — SplitIt",
    "updated": "Ultimo aggiornamento: 18 giugno 2026",
    "sections": [
      {
        "heading": "1. Dati raccolti",
        "blocks": [
          {
            "type": "p",
            "text": "SplitIt raccoglie soltanto i dati necessari al funzionamento dell'applicazione:"
          },
          {
            "type": "ul",
            "items": [
              "**Indirizzo e-mail e nome utente** — per creare e identificare il tuo account",
              "**Spese e gruppi** — gli importi, le descrizioni e le divisioni che inserisci",
              "**Foto degli scontrini** — solo se scegli di caricarne una"
            ]
          }
        ]
      },
      {
        "heading": "2. Utilizzo dei dati",
        "blocks": [
          {
            "type": "p",
            "text": "I tuoi dati sono utilizzati esclusivamente per:"
          },
          {
            "type": "ul",
            "items": [
              "Consentirti di accedere al tuo account",
              "Mostrare e condividere le tue spese con i membri dei tuoi gruppi",
              "Migliorare la precisione del riconoscimento degli scontrini (in forma anonima)"
            ]
          }
        ]
      },
      {
        "heading": "3. Condivisione dei dati",
        "blocks": [
          {
            "type": "p",
            "text": "Non vendiamo, non affittiamo e non condividiamo mai i tuoi dati personali con terzi per finalità commerciali."
          },
          {
            "type": "p",
            "text": "I dati sono conservati su server sicuri (Supabase / AWS UE)."
          }
        ]
      },
      {
        "heading": "4. Conservazione dei dati",
        "blocks": [
          {
            "type": "p",
            "text": "I tuoi dati sono conservati finché il tuo account è attivo. Puoi richiedere la cancellazione del tuo account in qualsiasi momento dall'applicazione (Impostazioni → Elimina il mio account)."
          }
        ]
      },
      {
        "heading": "5. Sicurezza",
        "blocks": [
          {
            "type": "p",
            "text": "Le password sono cifrate (bcrypt). Le comunicazioni sono cifrate tramite HTTPS."
          }
        ]
      },
      {
        "heading": "6. Contatto",
        "blocks": [
          {
            "type": "p",
            "text": "Per qualsiasi domanda: **ares88775@gmail.com**"
          }
        ]
      }
    ]
  }
}
