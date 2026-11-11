const _NS = {
    AUTH: 'jabber:iq:auth',
    BIND: 'urn:ietf:params:xml:ns:xmpp-bind',
    BOSH: 'urn:xmpp:xbosh',
    CLIENT: 'jabber:client',
    COMPONENT: 'jabber:component:accept' /** XEP-0114 */,
    DISCO_INFO: 'http://jabber.org/protocol/disco#info',
    DISCO_ITEMS: 'http://jabber.org/protocol/disco#items',
    DELAY: 'urn:xmpp:delay' /** XEP-0203 */,
    FRAMING: 'urn:ietf:params:xml:ns:xmpp-framing',
    HTTPBIND: 'http://jabber.org/protocol/httpbind',
    MUC: 'http://jabber.org/protocol/muc',
    PROFILE: 'jabber:iq:profile',
    ROSTER: 'jabber:iq:roster',
    SASL: 'urn:ietf:params:xml:ns:xmpp-sasl',
    SERVER: 'jabber:server',
    SESSION: 'urn:ietf:params:xml:ns:xmpp-session',
    SM: 'urn:xmpp:sm:3',
    STANZAS: 'urn:ietf:params:xml:ns:xmpp-stanzas',
    STREAM: 'http://etherx.jabber.org/streams',
    VERSION: 'jabber:iq:version',
    XHTML: 'http://www.w3.org/1999/xhtml',
    XHTML_IM: 'http://jabber.org/protocol/xhtml-im',
};
/**
 * Common namespace constants from the XMPP RFCs and XEPs.
 * Extensible at runtime via {@link Strophe.addNamespace}, hence the string
 * index signature.
 */
const NS = _NS;
const PARSE_ERROR_NS = 'http://www.w3.org/1999/xhtml';
/**
 * The version of the page↔worker message protocol spoken between
 * WorkerWebsocket and dist/shared-connection-worker.js. A SharedWorker can
 * outlive the pages that spawned it, so after a deploy a freshly loaded page
 * may attach to a worker from an older build (or vice versa). The version is
 * exchanged on _connect/_attach so that a mismatch fails loudly instead of
 * silently misbehaving.
 */
const SHARED_WORKER_PROTOCOL_VERSION = 3;
/**
 * Contains allowed tags, tag attributes, and css properties.
 * Used in the {@link Strophe.createHtml} function to filter incoming html into the allowed XHTML-IM subset.
 * See [XEP-0071](http://xmpp.org/extensions/xep-0071.html#profile-summary) for the list of recommended
 * allowed tags and their attributes.
 */
const XHTML = {
    tags: ['a', 'blockquote', 'br', 'cite', 'em', 'img', 'li', 'ol', 'p', 'span', 'strong', 'ul', 'body'],
    attributes: {
        'a': ['href'],
        'blockquote': ['style'],
        'br': [],
        'cite': ['style'],
        'em': [],
        'img': ['src', 'alt', 'style', 'height', 'width'],
        'li': ['style'],
        'ol': ['style'],
        'p': ['style'],
        'span': ['style'],
        'strong': [],
        'ul': ['style'],
        'body': [],
    },
    css: [
        'background-color',
        'color',
        'font-family',
        'font-size',
        'font-style',
        'font-weight',
        'margin-left',
        'margin-right',
        'text-align',
        'text-decoration',
    ],
};
/**
 * Connection status constants for use by the connection handler
 * callback.
 */
const Status = {
    ERROR: 0,
    CONNECTING: 1,
    CONNFAIL: 2,
    AUTHENTICATING: 3,
    AUTHFAIL: 4,
    CONNECTED: 5,
    DISCONNECTED: 6,
    DISCONNECTING: 7,
    ATTACHED: 8,
    REDIRECT: 9,
    CONNTIMEOUT: 10,
    BINDREQUIRED: 11,
    ATTACHFAIL: 12,
    RECONNECTING: 13,
};
const ErrorCondition = {
    BAD_FORMAT: 'bad-format',
    CONFLICT: 'conflict',
    MISSING_JID_NODE: 'x-strophe-bad-non-anon-jid',
    NO_AUTH_MECH: 'no-auth-mech',
    UNKNOWN_REASON: 'unknown',
};
const LOG_LEVELS = {
    DEBUG: 0,
    INFO: 1,
    WARN: 2,
    ERROR: 3,
    FATAL: 4,
};
/**
 * DOM element types.
 *
 * - ElementType.NORMAL - Normal element.
 * - ElementType.TEXT - Text data element.
 * - ElementType.CDATA - CDATA section.
 * - ElementType.PROCESSING_INSTRUCTION - Processing instruction.
 * - ElementType.COMMENT - Comment.
 * - ElementType.FRAGMENT - XHTML fragment element.
 */
const ElementType = {
    NORMAL: 1,
    TEXT: 3,
    CDATA: 4,
    PROCESSING_INSTRUCTION: 7,
    COMMENT: 8,
    FRAGMENT: 11,
};

let logLevel = LOG_LEVELS.DEBUG;
const log = {
    /**
     * Library consumers can use this function to set the log level of Strophe.
     * The default log level is Strophe.LogLevel.INFO.
     * @param level
     * @example Strophe.setLogLevel(Strophe.LogLevel.DEBUG);
     */
    setLogLevel(level) {
        if (level < LOG_LEVELS.DEBUG || level > LOG_LEVELS.FATAL) {
            throw new Error("Invalid log level supplied to setLogLevel");
        }
        logLevel = level;
    },
    /**
     *
     * Please note that data sent and received over the wire is logged
     * via {@link Strophe.Connection#rawInput|Strophe.Connection.rawInput()}
     * and {@link Strophe.Connection#rawOutput|Strophe.Connection.rawOutput()}.
     *
     * The different levels and their meanings are
     *
     *   DEBUG - Messages useful for debugging purposes.
     *   INFO - Informational messages.  This is mostly information like
     *     'disconnect was called' or 'SASL auth succeeded'.
     *   WARN - Warnings about potential problems.  This is mostly used
     *     to report transient connection errors like request timeouts.
     *   ERROR - Some error occurred.
     *   FATAL - A non-recoverable fatal error occurred.
     *
     * @param level - The log level of the log message.
     *     This will be one of the values in Strophe.LOG_LEVELS.
     * @param msg - The log message.
     */
    log(level, msg) {
        if (level < logLevel) {
            return;
        }
        if (level >= LOG_LEVELS.ERROR) {
            console === null || console === void 0 ? void 0 : console.error(msg);
        }
        else if (level === LOG_LEVELS.INFO) {
            console === null || console === void 0 ? void 0 : console.info(msg);
        }
        else if (level === LOG_LEVELS.WARN) {
            console === null || console === void 0 ? void 0 : console.warn(msg);
        }
        else if (level === LOG_LEVELS.DEBUG) {
            console === null || console === void 0 ? void 0 : console.debug(msg);
        }
    },
    /**
     * Log a message at the Strophe.LOG_LEVELS.DEBUG level.
     * @param msg - The log message.
     */
    debug(msg) {
        this.log(LOG_LEVELS.DEBUG, msg);
    },
    /**
     * Log a message at the Strophe.LOG_LEVELS.INFO level.
     * @param msg - The log message.
     */
    info(msg) {
        this.log(LOG_LEVELS.INFO, msg);
    },
    /**
     * Log a message at the Strophe.LOG_LEVELS.WARN level.
     * @param msg - The log message.
     */
    warn(msg) {
        this.log(LOG_LEVELS.WARN, msg);
    },
    /**
     * Log a message at the Strophe.LOG_LEVELS.ERROR level.
     * @param msg - The log message.
     */
    error(msg) {
        this.log(LOG_LEVELS.ERROR, msg);
    },
    /**
     * Log a message at the Strophe.LOG_LEVELS.FATAL level.
     * @param msg - The log message.
     */
    fatal(msg) {
        this.log(LOG_LEVELS.FATAL, msg);
    },
};

/*
 * Reading and checking the namespace of an element, in a module of its own so
 * that `whitespace` can reach it.
 *
 * {@link getNamespace} would otherwise live in `utils`, which is where the rest
 * of this kind of thing is. But `whitespace` needs it, and `utils` imports
 * `whitespace` for {@link stripWhitespace}, so `whitespace` cannot import
 * `utils` back without a cycle. {@link checkNamespace} has no such reason to be
 * here; it sits beside {@link getNamespace} because the two answer the same
 * question.
 *
 * {@link getNamespace} is re-exported by `utils`, which is what puts it on the
 * `Strophe` object. {@link checkNamespace} is internal and stays here.
 */
/**
 * Return the XML namespace of an element.
 *
 * Prefers the serialized `xmlns` attribute and falls back to the DOM
 * `namespaceURI`, because the two diverge depending on how the element was
 * built and neither is reliable on its own:
 *
 *  - Locally-built stanzas (`$iq`, `stx`, {@link Builder}) are created with
 *    `createElement` and carry their namespace only in the `xmlns` attribute;
 *    their `namespaceURI` is null.
 *  - Stanzas received over the XEP-0114 component transport are built with
 *    `createElementNS` and carry their namespace only on `namespaceURI`; the
 *    redundant `xmlns` attribute is omitted.
 *  - WebSocket / BOSH stanzas parsed by `DOMParser` carry both, except on
 *    child elements that inherit the default namespace without redeclaring it
 *    (those have only `namespaceURI`).
 *
 * Checking both is the transport-agnostic way to read an element's namespace.
 *
 * @method Strophe.getNamespace
 * @param elem - The element whose namespace is wanted.
 * @returns The namespace URI, or null if the element has none.
 */
function getNamespace(elem) {
    return elem.getAttribute('xmlns') || elem.namespaceURI;
}
/**
 * Complain about a stanza which is in neither of the namespaces a stanza may
 * be in.
 *
 * Only `message`, `iq` and `presence` are stanzas. Anything else is some other
 * element which happens to have been passed in, and is in whatever namespace
 * it likes.
 *
 * Reads `namespaceURI` rather than going through {@link getNamespace} because
 * every caller hands it an element which has just come out of the parser,
 * where the resolved namespace is the one that counts.
 *
 * @param node - The element to check.
 * @param throwErrorIfInvalidNS - Whether the wrong namespace is fatal rather
 *  than merely logged.
 */
function checkNamespace(node, throwErrorIfInvalidNS) {
    if (!['message', 'iq', 'presence'].includes(node.nodeName.toLowerCase()))
        return;
    if (node.namespaceURI === NS.CLIENT || node.namespaceURI === NS.SERVER)
        return;
    const err_msg = `Invalid namespaceURI ${node.namespaceURI}`;
    if (throwErrorIfInvalidNS) {
        throw new Error(err_msg);
    }
    else {
        log.error(err_msg);
    }
}

/**
 * Whether an element's whitespace-only text children are content instead of
 * formatting.
 *
 * @param el
 * @param inherited - Whether an ancestor already asked for preservation.
 */
function preservesWhitespace(el, inherited) {
    // XML 1.0 § 2.10: xml:space applies to the element and all its
    // descendants, until a descendant overrides it.
    const space = el.getAttribute('xml:space');
    if (space === 'preserve')
        return true;
    if (space === 'default')
        return false;
    // The XHTML-IM body of XEP-0071: markup a human wrote to be read, in which
    // a run of whitespace between two inline elements separates words rather
    // than laying them out, so removing it runs the words together.
    //
    // Only that <body>, which is why the namespace is read and not just the
    // name. A <body> anywhere else is a different element which happens to
    // share the name: a plain-text message body, whose whitespace is already
    // kept by the single-text-node rule above and which otherwise holds nothing
    // but the template's own indentation, or a BOSH wrapper, whose layout is
    // nobody's content.
    //
    // XHTML in some other element, such as the <div> of an Atom type="xhtml"
    // construct, is laid out by whatever wrote it and is stripped like the rest
    // of it. Interpolate the parts to keep the whitespace between them, which
    // is the whole point of a value being a value, or mark the element
    // `xml:space="preserve"` where there is no `${}` to put them in.
    //
    // Being a guess about what the markup is for, it loses to xml:space either
    // way round: the checks above come first, so `xml:space="default"` opts an
    // XHTML-IM body back out again.
    //
    // Read through {@link getNamespace} rather than off `namespaceURI`: a
    // stanza built rather than parsed, which is what `Builder` and `$msg().c()`
    // produce, carries its namespace in an `xmlns` attribute and has no
    // `namespaceURI` at all.
    if (getNamespace(el) === NS.XHTML && el.localName.toLowerCase() === 'body')
        return true;
    return inherited;
}
/**
 * Remove the whitespace which pretty-printing put between an element's tags.
 *
 * XML written by hand (or via the `stx` template literal) is usually indented,
 * and parsing it turns each run of indentation into a text node. Those
 * whitespace-only text nodes are formatting, not content, so they're removed.
 * Whitespace which is content is kept:
 *
 * - An element whose only child is a text node keeps it, so `<body>   </body>`
 *   survives intact.
 * - A subtree marked `xml:space="preserve"` is left alone, per XML 1.0 § 2.10,
 *   until a descendant sets `xml:space="default"` again.
 * - An XHTML-IM `<body>`, the one in the XHTML namespace, is left alone, since
 *   the whitespace between its inline elements separates words rather than
 *   laying them out, unless it sets `xml:space="default"`.
 * - Anything `keep` claims, which is how a caller which knows more than this
 *   function does says so.
 *
 * Kept out of `utils` because everything `utils` exports is spread onto the
 * `Strophe` object, and `keep` and `preserve` are internal rather than public
 * API. {@link stripWhitespace} is the public entry point.
 *
 * @param el
 * @param keep - Whether a whitespace-only text node is content after all.
 * @param preserve - Whether an ancestor asked for whitespace to be preserved.
 *  Only the recursion passes this.
 * @returns
 */
function strip(el, keep, preserve = false) {
    preserve = preservesWhitespace(el, preserve);
    const childNodes = Array.from(el.childNodes);
    if (childNodes.length === 1 && childNodes[0].nodeType === ElementType.TEXT) {
        return el;
    }
    childNodes.forEach((node) => {
        if (node.nodeType === ElementType.TEXT) {
            if (!preserve && !/\S/.test(node.nodeValue) && !keep(node)) {
                el.removeChild(node);
            }
        }
        else if (node.nodeType === ElementType.NORMAL) {
            strip(node, keep, preserve);
        }
    });
    return el;
}

/**
 * What XML 1.0 says a document may be made of, character by character.
 *
 * Kept in a module of its own because the `stx` builder and the Node DOM shim
 * both have to ask this, and neither is somewhere the other can import from.
 * It pulls in nothing itself, so the shim can have it at load time without
 * dragging the library along behind it.
 */
/**
 * Anything outside the `Char` production of XML 1.0 § 2.2.
 *
 * Tab, line feed and carriage return are the only control characters XML has;
 * the rest of C0, the unpaired surrogates and the two non-characters at the end
 * of the BMP cannot appear in a document at all, not even written as a
 * character reference. The `u` flag is what makes the last range mean whole
 * code points, so an astral character is one character here rather than the two
 * surrogates it is stored as.
 */
// eslint-disable-next-line no-control-regex -- the three XML does allow have to be named to be allowed
const NOT_XML_CHAR = /[^\u0009\u000A\u000D\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/u;
/**
 * The first character of `text` which XML cannot represent, if it holds one.
 *
 * The caller words its own error, since what is worth saying depends on where
 * the text came from: a value handed to `stx` can be pointed at and named,
 * whereas a document arriving at the parser can only be refused.
 *
 * @param text
 * @returns The character and where it is, or null if the text is entirely
 *  representable.
 */
function findDisallowedChar(text) {
    const found = NOT_XML_CHAR.exec(text);
    if (!found)
        return null;
    const point = found[0].codePointAt(0).toString(16).toUpperCase().padStart(4, '0');
    return { point: `U+${point}`, index: found.index };
}
/**
 * A string as XML is able to carry it, for the places one is put into a tree
 * without a parser ever reading it.
 *
 * Line endings are normalised as XML 1.0 § 2.11 requires. Left alone, a CRLF
 * reaches the wire intact and every recipient's parser turns it into a line
 * feed, so the sender's own tree disagrees with the one everyone else holds
 * about a message they all received whole.
 *
 * A character XML cannot represent is refused. Nothing escapes one, so a stanza
 * carrying it is unsendable: it would be serialized unchanged, and the server
 * would answer the stream with `not-well-formed` and close it, costing the
 * connection rather than the one message.
 *
 * @param text
 * @param subject - What to call the text in the error, as the sentence's
 *  subject: `A text node`, `The "id" attribute`.
 * @returns The text, with its line endings normalised.
 */
function xmlText(text, subject) {
    // `String()` because callers in plain JavaScript pass numbers to every API
    // which reaches here, and `createTextNode` and `setAttribute` took them
    // before this check stood in front of them.
    const normalised = String(text).replace(/\r\n?/g, '\n');
    const found = findDisallowedChar(normalised);
    if (found) {
        throw new Error(`${subject} holds ${found.point} at index ${found.index}, which XML cannot represent and no ` +
            `escape can stand in for. Remove it before building the stanza.`);
    }
    return normalised;
}
/**
 * Text already escaped by `xmlescape`, with its whitespace written so that an
 * attribute value reads it back unchanged.
 *
 * A parser normalises the whitespace in an attribute value (XML 1.0 § 3.3.3):
 * a tab, a line feed or a carriage return written literally is read back as a
 * space. Written as a character reference each is read back as itself, which is
 * the only way an attribute can carry one at all. Element content needs none of
 * it, since a parser leaves the whitespace between tags as it stands.
 *
 * Takes the text escaped rather than escaping it, so that this module still
 * pulls in nothing.
 *
 * @param escaped - Text which has been through `xmlescape`.
 * @returns The text, as an attribute value has to hold it.
 */
function attributeWhitespace(escaped) {
    return escaped.replace(/\t/g, '&#x9;').replace(/\n/g, '&#xA;').replace(/\r/g, '&#xD;');
}

/**
 * Takes a string and turns it into an XML Element.
 * @param string
 * @param throwErrorIfInvalidNS
 * @returns
 */
function toElement(string, throwErrorIfInvalidNS) {
    const doc = xmlHtmlNode(string);
    const parserError = getParserError(doc);
    if (parserError) {
        throw new Error(`Parser Error: ${parserError}`);
    }
    const node = getFirstElementChild(doc);
    checkNamespace(node, throwErrorIfInvalidNS);
    return node;
}
/**
 * Properly logs an error to the console
 * @param e
 */
function handleError(e) {
    if (typeof e.stack !== 'undefined') {
        log.fatal(e.stack);
    }
    log.fatal('error: ' + e.message);
}
/**
 * @param str
 * @returns
 */
function utf16to8(str) {
    let out = '';
    const len = str.length;
    for (let i = 0; i < len; i++) {
        const c = str.charCodeAt(i);
        if (c >= 0x0000 && c <= 0x007f) {
            out += str.charAt(i);
        }
        else if (c > 0x07ff) {
            out += String.fromCharCode(0xe0 | ((c >> 12) & 0x0f));
            out += String.fromCharCode(0x80 | ((c >> 6) & 0x3f));
            out += String.fromCharCode(0x80 | ((c >> 0) & 0x3f));
        }
        else {
            out += String.fromCharCode(0xc0 | ((c >> 6) & 0x1f));
            out += String.fromCharCode(0x80 | ((c >> 0) & 0x3f));
        }
    }
    return out;
}
/**
 * @param x
 * @param y
 * @returns
 */
function xorArrayBuffers(x, y) {
    const xIntArray = new Uint8Array(x);
    const yIntArray = new Uint8Array(y);
    const zIntArray = new Uint8Array(x.byteLength);
    for (let i = 0; i < x.byteLength; i++) {
        zIntArray[i] = xIntArray[i] ^ yIntArray[i];
    }
    return zIntArray.buffer;
}
/**
 * @param buffer
 * @returns
 */
function arrayBufToBase64(buffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}
/**
 * @param str
 * @returns
 */
function base64ToArrayBuf(str) {
    var _a;
    return (_a = Uint8Array.from(atob(str), (c) => c.charCodeAt(0))) === null || _a === void 0 ? void 0 : _a.buffer;
}
/**
 * @param str
 * @returns
 */
function stringToArrayBuf(str) {
    const bytes = new TextEncoder().encode(str);
    return bytes.buffer;
}
/**
 * @param cookies
 */
function addCookies(cookies) {
    if (typeof document === 'undefined') {
        log.error(`addCookies: not adding any cookies, since there's no document object`);
        return;
    }
    const cookieMap = cookies || {};
    for (const cookieName in cookieMap) {
        if (Object.prototype.hasOwnProperty.call(cookieMap, cookieName)) {
            let expires = '';
            let domain = '';
            let path = '';
            const cookieObj = cookieMap[cookieName];
            const isObj = typeof cookieObj === 'object';
            const cookieValue = escape(unescape(isObj ? cookieObj.value : cookieObj));
            if (isObj) {
                const cv = cookieObj;
                expires = cv.expires ? ';expires=' + cv.expires : '';
                domain = cv.domain ? ';domain=' + cv.domain : '';
                path = cv.path ? ';path=' + cv.path : '';
            }
            document.cookie = cookieName + '=' + cookieValue + expires + domain + path;
        }
    }
}
let _xmlGenerator = null;
/**
 * Get the DOM document to generate elements.
 * @returns The currently used DOM document.
 */
function xmlGenerator() {
    if (!_xmlGenerator) {
        _xmlGenerator = document.implementation.createDocument('jabber:client', 'strophe', null);
    }
    return _xmlGenerator;
}
/**
 * Creates an XML DOM text node.
 * Provides a cross implementation version of document.createTextNode.
 *
 * The text is put through {@link xmlText} first. Nothing parses a node built
 * this way, on its way in or on its way out, so this is the only chance to
 * refuse text which cannot be sent. See {@link xmlText} for what that means.
 *
 * @param text - The content of the text node.
 * @returns A new XML DOM text node.
 */
function xmlTextNode(text) {
    return xmlGenerator().createTextNode(xmlText(text, 'A text node'));
}
/**
 * Remove the whitespace which pretty-printing put between an element's tags.
 *
 * XML written by hand (or via the {@link Stanza} template literal) is usually
 * indented, and parsing it turns each run of indentation into a text node.
 * Those whitespace-only text nodes are formatting, not content, so they're
 * removed. Whitespace which is content is kept:
 *
 * - An element whose only child is a text node keeps it, so `<body>   </body>`
 *   survives intact.
 * - A subtree marked `xml:space="preserve"` is left alone, per XML 1.0 § 2.10,
 *   until a descendant sets `xml:space="default"` again.
 * - An XHTML-IM `<body>`, the one in the XHTML namespace, is left alone, since
 *   the whitespace between its inline elements separates words rather than
 *   laying them out.
 *
 * Whitespace interpolated into an `stx` template is content as well, but by
 * the time the template has been concatenated into a string it can no longer
 * be told apart from indentation. {@link Stanza} therefore marks it before
 * parsing rather than exempting it here.
 *
 * @param stanza
 * @returns
 */
function stripWhitespace(stanza) {
    return strip(stanza, () => false);
}
/**
 * Creates an XML DOM node.
 * @param text - The contents of the XML element.
 * @returns
 */
function xmlHtmlNode(text) {
    const parser = new DOMParser();
    return parser.parseFromString(text, 'text/xml');
}
/**
 * @param doc
 * @returns
 */
function getParserError(doc) {
    var _a;
    const el = ((_a = doc.firstElementChild) === null || _a === void 0 ? void 0 : _a.nodeName) === 'parsererror'
        ? doc.firstElementChild
        : doc.getElementsByTagNameNS(PARSE_ERROR_NS, 'parsererror')[0];
    return (el === null || el === void 0 ? void 0 : el.nodeName) === 'parsererror' ? el === null || el === void 0 ? void 0 : el.textContent : null;
}
/**
 * @param el
 * @returns
 */
function getFirstElementChild(el) {
    if (el.firstElementChild)
        return el.firstElementChild;
    let node;
    let i = 0;
    const nodes = el.childNodes;
    while ((node = nodes[i++])) {
        if (node.nodeType === ElementType.NORMAL)
            return node;
    }
    return null;
}
/**
 * Create an XML DOM element.
 *
 * This function creates an XML DOM element correctly across all
 * implementations. Note that these are not HTML DOM elements, which
 * aren't appropriate for XMPP stanzas.
 *
 * @param name - The name for the element.
 * @param attrs
 *    An optional array or object containing
 *    key/value pairs to use as element attributes.
 *    The object should be in the format `{'key': 'value'}`.
 *    The array should have the format `[['key1', 'value1'], ['key2', 'value2']]`.
 * @param text - The text child data for the element.
 *
 * @returns A new XML DOM element.
 */
function xmlElement(name, attrs, text) {
    if (!name)
        return null;
    const node = xmlGenerator().createElement(name);
    if (text && (typeof text === 'string' || typeof text === 'number')) {
        node.appendChild(xmlTextNode(text.toString()));
    }
    else if (typeof attrs === 'string' || typeof attrs === 'number') {
        node.appendChild(xmlTextNode(attrs.toString()));
        return node;
    }
    if (!attrs) {
        return node;
    }
    else if (Array.isArray(attrs)) {
        for (const attr of attrs) {
            if (Array.isArray(attr)) {
                if (attr[0] != null && attr[1] != null) {
                    node.setAttribute(attr[0], xmlText(attr[1], `The "${attr[0]}" attribute`));
                }
            }
        }
    }
    else if (typeof attrs === 'object') {
        for (const k of Object.keys(attrs)) {
            if (k && attrs[k] != null) {
                node.setAttribute(k, xmlText(attrs[k].toString(), `The "${k}" attribute`));
            }
        }
    }
    return node;
}
/**
 * Utility method to determine whether a tag is allowed
 * in the XHTML_IM namespace.
 *
 * XHTML tag names are case sensitive and must be lower case.
 * @method Strophe.XHTML.validTag
 * @param tag
 */
function validTag(tag) {
    for (let i = 0; i < XHTML.tags.length; i++) {
        if (tag === XHTML.tags[i]) {
            return true;
        }
    }
    return false;
}
/**
 * Utility method to determine whether an attribute is allowed
 * as recommended per XEP-0071
 *
 * XHTML attribute names are case sensitive and must be lower case.
 * @method Strophe.XHTML.validAttribute
 * @param tag
 * @param attribute
 */
function validAttribute(tag, attribute) {
    const attrs = XHTML.attributes[tag];
    if ((attrs === null || attrs === void 0 ? void 0 : attrs.length) > 0) {
        for (let i = 0; i < attrs.length; i++) {
            if (attribute === attrs[i]) {
                return true;
            }
        }
    }
    return false;
}
/**
 * @method Strophe.XHTML.validCSS
 * @param style
 */
function validCSS(style) {
    for (let i = 0; i < XHTML.css.length; i++) {
        if (style === XHTML.css[i]) {
            return true;
        }
    }
    return false;
}
/**
 * Copy an HTML DOM Element into an XML DOM.
 * This function copies a DOM element and all its descendants and returns
 * the new copy.
 * @param elem - A DOM element.
 * @returns A new, copied DOM element tree.
 */
function createFromHtmlElement(elem) {
    var _a;
    let el;
    const tag = elem.nodeName.toLowerCase();
    if (validTag(tag)) {
        try {
            el = xmlElement(tag);
            if (tag in XHTML.attributes) {
                const attrs = XHTML.attributes[tag];
                for (let i = 0; i < attrs.length; i++) {
                    const attribute = attrs[i];
                    let value = elem.getAttribute(attribute);
                    if (typeof value === 'undefined' || value === null || value === '') {
                        continue;
                    }
                    if (attribute === 'style' && typeof value === 'object') {
                        value = (_a = value.cssText) !== null && _a !== void 0 ? _a : value;
                    }
                    if (attribute === 'style') {
                        const css = [];
                        const cssAttrs = value.split(';');
                        for (let j = 0; j < cssAttrs.length; j++) {
                            const attr = cssAttrs[j].split(':');
                            const cssName = attr[0].replace(/^\s*/, '').replace(/\s*$/, '').toLowerCase();
                            if (validCSS(cssName)) {
                                const cssValue = attr[1].replace(/^\s*/, '').replace(/\s*$/, '');
                                css.push(cssName + ': ' + cssValue);
                            }
                        }
                        if (css.length > 0) {
                            value = css.join('; ');
                            el.setAttribute(attribute, value);
                        }
                    }
                    else {
                        el.setAttribute(attribute, value);
                    }
                }
                for (let i = 0; i < elem.childNodes.length; i++) {
                    el.appendChild(createHtml(elem.childNodes[i]));
                }
            }
        }
        catch (_e) {
            el = xmlTextNode('');
        }
    }
    else {
        el = xmlGenerator().createDocumentFragment();
        for (let i = 0; i < elem.childNodes.length; i++) {
            el.appendChild(createHtml(elem.childNodes[i]));
        }
    }
    return el;
}
/**
 * Copy an HTML DOM Node into an XML DOM.
 * This function copies a DOM element and all its descendants and returns
 * the new copy.
 * @method Strophe.createHtml
 * @param node - A DOM element.
 * @returns A new, copied DOM element tree.
 */
function createHtml(node) {
    if (node.nodeType === ElementType.NORMAL) {
        return createFromHtmlElement(node);
    }
    else if (node.nodeType === ElementType.FRAGMENT) {
        const el = xmlGenerator().createDocumentFragment();
        for (let i = 0; i < node.childNodes.length; i++) {
            el.appendChild(createHtml(node.childNodes[i]));
        }
        return el;
    }
    else if (node.nodeType === ElementType.TEXT) {
        return xmlTextNode(node.nodeValue);
    }
}
/**
 * Copy an XML DOM element.
 *
 * This function copies a DOM element and all its descendants and returns
 * the new copy.
 * @method Strophe.copyElement
 * @param node - A DOM element.
 * @returns A new, copied DOM element tree.
 */
function copyElement(node) {
    let out;
    if (node.nodeType === ElementType.NORMAL) {
        const el = node;
        out = xmlElement(el.tagName);
        for (let i = 0; i < el.attributes.length; i++) {
            out.setAttribute(el.attributes[i].nodeName, el.attributes[i].value);
        }
        for (let i = 0; i < el.childNodes.length; i++) {
            out.appendChild(copyElement(el.childNodes[i]));
        }
    }
    else if (node.nodeType === ElementType.TEXT) {
        out = xmlGenerator().createTextNode(node.nodeValue);
    }
    return out;
}
/**
 * Excapes invalid xml characters.
 * @method Strophe.xmlescape
 * @param text - text to escape.
 * @returns Escaped text.
 */
function xmlescape(text) {
    return text
        .replace(/\&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/'/g, '&apos;')
        .replace(/"/g, '&quot;');
}
/**
 * Unexcapes invalid xml characters.
 * @method Strophe.xmlunescape
 * @param text - text to unescape.
 * @returns Unescaped text.
 */
function xmlunescape(text) {
    text = text.replace(/\&amp;/g, '&');
    text = text.replace(/&lt;/g, '<');
    text = text.replace(/&gt;/g, '>');
    text = text.replace(/&apos;/g, "'");
    text = text.replace(/&quot;/g, '"');
    return text;
}
/**
 * Map a function over some or all child elements of a given element.
 *
 * This is a small convenience function for mapping a function over
 * some or all of the children of an element.  If elemName is null, all
 * children will be passed to the function, otherwise only children
 * whose tag names match elemName will be passed.
 *
 * @method Strophe.forEachChild
 * @param elem - The element to operate on.
 * @param elemName - The child element tag name filter.
 * @param func - The function to apply to each child.  This
 *    function should take a single argument, a DOM element.
 */
function forEachChild(elem, elemName, func) {
    for (let i = 0; i < elem.childNodes.length; i++) {
        const childNode = elem.childNodes[i];
        if (childNode.nodeType === ElementType.NORMAL && (!elemName || isTagEqual(childNode, elemName))) {
            func(childNode);
        }
    }
}
/**
 * Compare an element's tag name with a string.
 * This function is case sensitive.
 * @method Strophe.isTagEqual
 * @param el - A DOM element.
 * @param name - The element name.
 * @returns
 *  true if the element's tag name matches _el_, and false
 *  otherwise.
 */
function isTagEqual(el, name) {
    return el.tagName === name;
}
/**
 * Get the concatenation of all text children of an element.
 * @method Strophe.getText
 * @param elem - A DOM element.
 * @returns A String with the concatenated text of all text element children.
 */
function getText(elem) {
    if (!elem)
        return null;
    let str = '';
    if (!elem.childNodes.length && elem.nodeType === ElementType.TEXT) {
        str += elem.nodeValue;
    }
    for (const child of elem.childNodes) {
        if (child.nodeType === ElementType.TEXT) {
            str += child.nodeValue;
        }
    }
    return xmlescape(str);
}
/**
 * Escape the node part (also called local part) of a JID.
 * @method Strophe.escapeNode
 * @param node - A node (or local part).
 * @returns An escaped node (or local part).
 */
function escapeNode(node) {
    if (typeof node !== 'string') {
        return node;
    }
    return node
        .replace(/^\s+|\s+$/g, '')
        .replace(/\\/g, '\\5c')
        .replace(/ /g, '\\20')
        .replace(/\"/g, '\\22')
        .replace(/\&/g, '\\26')
        .replace(/\'/g, '\\27')
        .replace(/\//g, '\\2f')
        .replace(/:/g, '\\3a')
        .replace(/</g, '\\3c')
        .replace(/>/g, '\\3e')
        .replace(/@/g, '\\40');
}
/**
 * Unescape a node part (also called local part) of a JID.
 * @method Strophe.unescapeNode
 * @param node - A node (or local part).
 * @returns An unescaped node (or local part).
 */
function unescapeNode(node) {
    if (typeof node !== 'string') {
        return node;
    }
    return node
        .replace(/\\20/g, ' ')
        .replace(/\\22/g, '"')
        .replace(/\\26/g, '&')
        .replace(/\\27/g, "'")
        .replace(/\\2f/g, '/')
        .replace(/\\3a/g, ':')
        .replace(/\\3c/g, '<')
        .replace(/\\3e/g, '>')
        .replace(/\\40/g, '@')
        .replace(/\\5c/g, '\\');
}
/**
 * Get the node portion of a JID String.
 * @method Strophe.getNodeFromJid
 * @param jid - A JID.
 * @returns A String containing the node.
 */
function getNodeFromJid(jid) {
    if (jid.indexOf('@') < 0) {
        return null;
    }
    return jid.split('@')[0];
}
/**
 * Get the domain portion of a JID String.
 * @method Strophe.getDomainFromJid
 * @param jid - A JID.
 * @returns A String containing the domain.
 */
function getDomainFromJid(jid) {
    const bare = getBareJidFromJid(jid);
    if (bare.indexOf('@') < 0) {
        return bare;
    }
    else {
        const parts = bare.split('@');
        parts.splice(0, 1);
        return parts.join('@');
    }
}
/**
 * Get the resource portion of a JID String.
 * @method Strophe.getResourceFromJid
 * @param jid - A JID.
 * @returns A String containing the resource.
 */
function getResourceFromJid(jid) {
    if (!jid) {
        return null;
    }
    const s = jid.split('/');
    if (s.length < 2) {
        return null;
    }
    s.splice(0, 1);
    return s.join('/');
}
/**
 * Get the bare JID from a JID String.
 * @method Strophe.getBareJidFromJid
 * @param jid - A JID.
 * @returns A String containing the bare JID.
 */
function getBareJidFromJid(jid) {
    return jid ? jid.split('/')[0] : null;
}
const utils = {
    utf16to8,
    xorArrayBuffers,
    arrayBufToBase64,
    base64ToArrayBuf,
    stringToArrayBuf,
    addCookies,
};

var utils$1 = /*#__PURE__*/Object.freeze({
    __proto__: null,
    addCookies: addCookies,
    arrayBufToBase64: arrayBufToBase64,
    base64ToArrayBuf: base64ToArrayBuf,
    copyElement: copyElement,
    createHtml: createHtml,
    default: utils,
    escapeNode: escapeNode,
    forEachChild: forEachChild,
    getBareJidFromJid: getBareJidFromJid,
    getDomainFromJid: getDomainFromJid,
    getFirstElementChild: getFirstElementChild,
    getNamespace: getNamespace,
    getNodeFromJid: getNodeFromJid,
    getParserError: getParserError,
    getResourceFromJid: getResourceFromJid,
    getText: getText,
    handleError: handleError,
    isTagEqual: isTagEqual,
    stringToArrayBuf: stringToArrayBuf,
    stripWhitespace: stripWhitespace,
    toElement: toElement,
    unescapeNode: unescapeNode,
    utf16to8: utf16to8,
    validAttribute: validAttribute,
    validCSS: validCSS,
    validTag: validTag,
    xmlElement: xmlElement,
    xmlGenerator: xmlGenerator,
    xmlHtmlNode: xmlHtmlNode,
    xmlTextNode: xmlTextNode,
    xmlescape: xmlescape,
    xmlunescape: xmlunescape,
    xorArrayBuffers: xorArrayBuffers
});

/******************************************************************************
Copyright (c) Microsoft Corporation.

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY
AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
PERFORMANCE OF THIS SOFTWARE.
***************************************************************************** */
/* global Reflect, Promise, SuppressedError, Symbol, Iterator */


function __awaiter(thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
}

function __classPrivateFieldGet(receiver, state, kind, f) {
    if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a getter");
    if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot read private member from an object whose class did not declare it");
    return kind === "m" ? f : kind === "a" ? f.call(receiver) : f ? f.value : state.get(receiver);
}

function __classPrivateFieldSet(receiver, state, value, kind, f) {
    if (kind === "m") throw new TypeError("Private method is not writable");
    if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a setter");
    if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot write private member to an object whose class did not declare it");
    return (kind === "a" ? f.call(receiver, value) : f ? f.value = value : state.set(receiver, value)), value;
}

typeof SuppressedError === "function" ? SuppressedError : function (error, suppressed, message) {
    var e = new Error(message);
    return e.name = "SuppressedError", e.error = error, e.suppressed = suppressed, e;
};

var _Builder_nodeTree, _Builder_node, _Builder_name, _Builder_attrs;
/**
 * Create a {@link Strophe.Builder}
 * This is an alias for `new Strophe.Builder(name, attrs)`.
 * @param name - The root element name.
 * @param attrs - The attributes for the root element in object notation.
 * @returns A new Strophe.Builder object.
 */
function $build(name, attrs) {
    return new Builder(name, attrs);
}
/**
 * Create a {@link Strophe.Builder} with a `<message/>` element as the root.
 * @param attrs - The <message/> element attributes in object notation.
 * @returns A new Strophe.Builder object.
 */
function $msg(attrs) {
    return new Builder('message', attrs);
}
/**
 * Create a {@link Strophe.Builder} with an `<iq/>` element as the root.
 * @param attrs - The <iq/> element attributes in object notation.
 * @returns A new Strophe.Builder object.
 */
function $iq(attrs) {
    return new Builder('iq', attrs);
}
/**
 * Create a {@link Strophe.Builder} with a `<presence/>` element as the root.
 * @param attrs - The <presence/> element attributes in object notation.
 * @returns A new Strophe.Builder object.
 */
function $pres(attrs) {
    return new Builder('presence', attrs);
}
/**
 * This class provides an interface similar to JQuery but for building
 * DOM elements easily and rapidly.  All the functions except for `toString()`
 * and tree() return the object, so calls can be chained.
 *
 * The corresponding DOM manipulations to get a similar fragment would be
 * a lot more tedious and probably involve several helper variables.
 *
 * Since adding children makes new operations operate on the child, up()
 * is provided to traverse up the tree.  To add two children, do
 * > builder.c('child1', ...).up().c('child2', ...)
 *
 * The next operation on the Builder will be relative to the second child.
 *
 * @example
 *  // Here's an example using the $iq() builder helper.
 *  $iq({to: 'you', from: 'me', type: 'get', id: '1'})
 *      .c('query', {xmlns: 'strophe:example'})
 *      .c('example')
 *      .toString()
 *
 *  // The above generates this XML fragment
 *  //  <iq to='you' from='me' type='get' id='1'>
 *  //    <query xmlns='strophe:example'>
 *  //      <example/>
 *  //    </query>
 *  //  </iq>
 */
class Builder {
    /**
     * The attributes should be passed in object notation.
     * @param name - The name of the root element.
     * @param attrs - The attributes for the root element in object notation.
     * @example const b = new Builder('message', {to: 'you', from: 'me'});
     * @example const b = new Builder('messsage', {'xml:lang': 'en'});
     */
    constructor(name, attrs) {
        _Builder_nodeTree.set(this, void 0);
        _Builder_node.set(this, void 0);
        _Builder_name.set(this, void 0);
        _Builder_attrs.set(this, void 0);
        // Set correct namespace for jabber:client elements
        if (name === 'presence' || name === 'message' || name === 'iq') {
            if (attrs && !attrs.xmlns) {
                attrs.xmlns = NS.CLIENT;
            }
            else if (!attrs) {
                attrs = { xmlns: NS.CLIENT };
            }
        }
        __classPrivateFieldSet(this, _Builder_name, name, "f");
        __classPrivateFieldSet(this, _Builder_attrs, attrs, "f");
    }
    /**
     * Creates a new Builder object from an XML string.
     * @param str
     * @returns
     * @example const stanza = Builder.fromString('<presence from="juliet@example.com/chamber"></presence>');
     */
    static fromString(str) {
        const el = toElement(str, true);
        const b = new Builder('');
        __classPrivateFieldSet(b, _Builder_nodeTree, el, "f");
        return b;
    }
    buildTree() {
        return xmlElement(__classPrivateFieldGet(this, _Builder_name, "f"), __classPrivateFieldGet(this, _Builder_attrs, "f"));
    }
    get nodeTree() {
        if (!__classPrivateFieldGet(this, _Builder_nodeTree, "f")) {
            // Holds the tree being built.
            __classPrivateFieldSet(this, _Builder_nodeTree, this.buildTree(), "f");
        }
        return __classPrivateFieldGet(this, _Builder_nodeTree, "f");
    }
    get node() {
        if (!__classPrivateFieldGet(this, _Builder_node, "f")) {
            __classPrivateFieldSet(this, _Builder_node, this.tree(), "f");
        }
        return __classPrivateFieldGet(this, _Builder_node, "f");
    }
    set node(el) {
        __classPrivateFieldSet(this, _Builder_node, el, "f");
    }
    /**
     * Render a DOM element and all descendants to a String.
     * @param elem - A DOM element.
     * @returns The serialized element tree as a String.
     */
    static serialize(elem) {
        if (!elem)
            return null;
        const el = elem instanceof Builder ? elem.tree() : elem;
        const names = [...Array(el.attributes.length).keys()].map((i) => el.attributes[i].nodeName);
        names.sort();
        // Escaping the whitespace is what makes the line endings xmlText
        // normalised on the way in worth anything here: written literally, the
        // tree held a line feed and every recipient's tree a space.
        let result = names.reduce((a, n) => `${a} ${n}="${attributeWhitespace(xmlescape(el.attributes.getNamedItem(n).value))}"`, `<${el.nodeName}`);
        if (el.childNodes.length > 0) {
            result += '>';
            for (let i = 0; i < el.childNodes.length; i++) {
                const child = el.childNodes[i];
                switch (child.nodeType) {
                    case ElementType.NORMAL:
                        result += Builder.serialize(child);
                        break;
                    case ElementType.TEXT:
                        result += xmlescape(child.nodeValue);
                        break;
                    case ElementType.CDATA:
                        result += '<![CDATA[' + child.nodeValue + ']]>';
                }
            }
            result += '</' + el.nodeName + '>';
        }
        else {
            result += '/>';
        }
        return result;
    }
    /**
     * Return the DOM tree.
     *
     * This function returns the current DOM tree as an element object.  This
     * is suitable for passing to functions like Strophe.Connection.send().
     *
     * @returns The DOM tree as a element object.
     */
    tree() {
        return this.nodeTree;
    }
    /**
     * Serialize the DOM tree to a String.
     *
     * This function returns a string serialization of the current DOM
     * tree.  It is often used internally to pass data to a
     * Strophe.Request object.
     *
     * @returns The serialized DOM tree in a String.
     */
    toString() {
        return Builder.serialize(this.tree());
    }
    /**
     * Make the current parent element the new current element.
     * This function is often used after c() to traverse back up the tree.
     *
     * @example
     *  // For example, to add two children to the same element
     *  builder.c('child1', {}).up().c('child2', {});
     *
     * @returns The Strophe.Builder object.
     */
    up() {
        this.node = this.node.parentElement ? this.node.parentElement : this.node.parentNode;
        return this;
    }
    /**
     * Make the root element the new current element.
     *
     * When at a deeply nested element in the tree, this function can be used
     * to jump back to the root of the tree, instead of having to repeatedly
     * call up().
     *
     * @returns The Strophe.Builder object.
     */
    root() {
        this.node = this.tree();
        return this;
    }
    /**
     * Add or modify attributes of the current element.
     *
     * The attributes should be passed in object notation.
     * This function does not move the current element pointer.
     * @param moreattrs - The attributes to add/modify in object notation.
     *  If an attribute is set to `null` or `undefined`, it will be removed.
     * @returns The Strophe.Builder object.
     */
    attrs(moreattrs) {
        for (const k in moreattrs) {
            if (Object.prototype.hasOwnProperty.call(moreattrs, k)) {
                if (moreattrs[k] != null) {
                    this.node.setAttribute(k, xmlText(moreattrs[k].toString(), `The "${k}" attribute`));
                }
                else {
                    this.node.removeAttribute(k);
                }
            }
        }
        return this;
    }
    /**
     * Add a child to the current element and make it the new current
     * element.
     *
     * This function moves the current element pointer to the child,
     * unless text is provided.  If you need to add another child, it
     * is necessary to use up() to go back to the parent in the tree.
     *
     * @param name - The name of the child.
     * @param attrs - The attributes of the child in object notation.
     * @param text - The text to add to the child.
     *
     * @returns The Strophe.Builder object.
     */
    c(name, attrs, text) {
        const child = xmlElement(name, attrs, text);
        this.node.appendChild(child);
        if (typeof text !== 'string' && typeof text !== 'number') {
            this.node = child;
        }
        return this;
    }
    /**
     * Add a child to the current element and make it the new current
     * element.
     *
     * This function is the same as c() except that instead of using a
     * name and an attributes object to create the child it uses an
     * existing DOM element object.
     *
     * @param elem - A DOM element.
     * @returns The Strophe.Builder object.
     */
    cnode(elem) {
        if (elem instanceof Builder) {
            elem = elem.tree();
        }
        let impNode;
        const xmlGen = xmlGenerator();
        try {
            impNode = xmlGen.importNode !== undefined;
        }
        catch (_e) {
            impNode = false;
        }
        const newElem = impNode ? xmlGen.importNode(elem, true) : copyElement(elem);
        this.node.appendChild(newElem);
        this.node = newElem;
        return this;
    }
    /**
     * Add a child text element.
     *
     * This *does not* make the child the new current element since there
     * are no children of text elements.
     *
     * @param text - The text data to append to the current element.
     * @returns The Strophe.Builder object.
     */
    t(text) {
        const child = xmlTextNode(text);
        this.node.appendChild(child);
        return this;
    }
    /**
     * Replace current element contents with the HTML passed in.
     *
     * This *does not* make the child the new current element
     *
     * @param html - The html to insert as contents of current element.
     * @returns The Strophe.Builder object.
     */
    h(html) {
        const fragment = xmlGenerator().createElement('body');
        fragment.innerHTML = html;
        const xhtml = createHtml(fragment);
        while (xhtml.childNodes.length > 0) {
            this.node.appendChild(xhtml.childNodes[0]);
        }
        return this;
    }
}
_Builder_nodeTree = new WeakMap(), _Builder_node = new WeakMap(), _Builder_name = new WeakMap(), _Builder_attrs = new WeakMap();

/**
 * _Private_ variable that keeps track of the request ids for connections.
 */
let _requestId = 0;
/**
 * Helper class that provides a cross implementation abstraction
 * for a BOSH related XMLHttpRequest.
 *
 * The Request class is used internally to encapsulate BOSH request
 * information.  It is not meant to be used from user's code.
 */
class Request {
    /**
     * Create and initialize a new Request object.
     *
     * @param elem - The XML data to be sent in the request.
     * @param func - The function that will be called when the
     *     XMLHttpRequest readyState changes.
     * @param rid - The BOSH rid attribute associated with this request.
     * @param sends - The number of times this same request has been sent.
     */
    constructor(elem, func, rid, sends = 0) {
        this.id = ++_requestId;
        this.xmlData = elem;
        this.data = Builder.serialize(elem);
        this.origFunc = func;
        this.func = func;
        this.rid = rid;
        this.date = NaN;
        this.sends = sends;
        this.abort = false;
        this.dead = null;
        this.age = () => (this.date ? (new Date().valueOf() - this.date.valueOf()) / 1000 : 0);
        this.timeDead = () => (this.dead ? (new Date().valueOf() - this.dead.valueOf()) / 1000 : 0);
        this.xhr = this._newXHR();
    }
    /**
     * Get a response from the underlying XMLHttpRequest.
     * This function attempts to get a response from the request and checks
     * for errors.
     * @throws "parsererror" - A parser error occured.
     * @throws "bad-format" - The entity has sent XML that cannot be processed.
     * @returns The DOM element tree of the response.
     */
    getResponse() {
        var _a;
        const node = (_a = this.xhr.responseXML) === null || _a === void 0 ? void 0 : _a.documentElement;
        if (node) {
            if (node.tagName === 'parsererror') {
                log.error('invalid response received');
                log.error('responseText: ' + this.xhr.responseText);
                log.error('responseXML: ' + Builder.serialize(node));
                throw new Error('parsererror');
            }
        }
        else if (this.xhr.responseText) {
            log.debug('Got responseText but no responseXML; attempting to parse it with DOMParser...');
            const doc = xmlHtmlNode(this.xhr.responseText);
            const parserError = getParserError(doc);
            if (!doc || parserError) {
                if (parserError) {
                    log.error('invalid response received: ' + parserError);
                    log.error('responseText: ' + this.xhr.responseText);
                }
                const error = new Error();
                error.name = ErrorCondition.BAD_FORMAT;
                throw error;
            }
        }
        return node !== null && node !== void 0 ? node : null;
    }
    /**
     * _Private_ helper function to create XMLHttpRequests.
     * This function creates XMLHttpRequests across all implementations.
     * @private
     */
    _newXHR() {
        const xhr = new XMLHttpRequest();
        if (xhr.overrideMimeType) {
            xhr.overrideMimeType('text/xml; charset=utf-8');
        }
        xhr.onreadystatechange = this.func.bind(null, this);
        return xhr;
    }
}

/**
 * A JavaScript library to enable BOSH in Strophejs.
 *
 * this library uses Bidirectional-streams Over Synchronous HTTP (BOSH)
 * to emulate a persistent, stateful, two-way connection to an XMPP server.
 * More information on BOSH can be found in XEP 124.
 */
let timeoutMultiplier = 1.1;
let secondaryTimeoutMultiplier = 0.1;
/**
 * _Private_ helper class that handles BOSH Connections
 * The Bosh class is used internally by Connection
 * to encapsulate BOSH sessions. It is not meant to be used from user's code.
 */
class Bosh {
    /**
     * @param connection - The Connection that will use BOSH.
     */
    constructor(connection) {
        var _a;
        this._conn = connection;
        /* request id for body tags */
        this.rid = Math.floor(Math.random() * 4294967295);
        /* The current session ID. */
        this.sid = null;
        // default BOSH values
        this.hold = 1;
        this.wait = 60;
        this.window = 5;
        this.errors = 0;
        this.inactivity = null;
        /**
         * BOSH-Connections will have all stanzas wrapped in a <body> tag when
         * passed to {@link Connection#xmlInput|xmlInput()} or {@link Connection#xmlOutput|xmlOutput()}.
         * To strip this tag, User code can set {@link Bosh#strip|strip} to `true`:
         *
         * > // You can set `strip` on the prototype
         * > Bosh.prototype.strip = true;
         *
         * > // Or you can set it on the Bosh instance (which is `._proto` on the connection instance.
         * > const conn = new Connection();
         * > conn._proto.strip = true;
         *
         * This will enable stripping of the body tag in both
         * {@link Connection#xmlInput|xmlInput} and {@link Connection#xmlOutput|xmlOutput}.
         */
        this.strip = (_a = Bosh.prototype.strip) !== null && _a !== void 0 ? _a : false;
        this.lastResponseHeaders = null;
        this._requests = [];
    }
    static setTimeoutMultiplier(m) {
        timeoutMultiplier = m;
    }
    static getTimeoutMultplier() {
        return timeoutMultiplier;
    }
    static setSecondaryTimeoutMultiplier(m) {
        secondaryTimeoutMultiplier = m;
    }
    static getSecondaryTimeoutMultplier() {
        return secondaryTimeoutMultiplier;
    }
    /**
     * _Private_ helper function to generate the <body/> wrapper for BOSH.
     * @private
     * @returns A Builder with a <body/> element.
     */
    _buildBody() {
        const bodyWrap = $build('body', {
            'rid': this.rid++,
            'xmlns': NS.HTTPBIND,
        });
        if (this.sid !== null) {
            bodyWrap.attrs({ 'sid': this.sid });
        }
        if (this._conn.options.keepalive && this._conn._sessionCachingSupported()) {
            this._cacheSession();
        }
        return bodyWrap;
    }
    /**
     * Reset the connection.
     * This function is called by the reset function of the Connection
     */
    _reset() {
        this.rid = Math.floor(Math.random() * 4294967295);
        this.sid = null;
        this.errors = 0;
        if (this._conn._sessionCachingSupported()) {
            sessionStorage.removeItem('strophe-bosh-session');
        }
        this._conn.nextValidRid(this.rid);
    }
    /**
     * _Private_ function that initializes the BOSH connection.
     * Creates and sends the Request that initializes the BOSH connection.
     * @param wait - The optional HTTPBIND wait value.  This is the
     *     time the server will wait before returning an empty result for
     *     a request.  The default setting of 60 seconds is recommended.
     *     Other settings will require tweaks to the Strophe.TIMEOUT value.
     * @param hold - The optional HTTPBIND hold value.  This is the
     *     number of connections the server will hold at one time.  This
     *     should almost always be set to 1 (the default).
     * @param route
     */
    _connect(wait, hold, route) {
        this.wait = wait || this.wait;
        this.hold = hold || this.hold;
        this.errors = 0;
        const body = this._buildBody().attrs({
            'to': this._conn.domain,
            'xml:lang': 'en',
            'wait': this.wait,
            'hold': this.hold,
            'content': 'text/xml; charset=utf-8',
            'ver': '1.6',
            'xmpp:version': '1.0',
            'xmlns:xmpp': NS.BOSH,
        });
        if (route) {
            body.attrs({ route });
        }
        const _connect_cb = this._conn._connect_cb;
        this._requests.push(new Request(body.tree(), this._onRequestStateChange.bind(this, _connect_cb.bind(this._conn)), Number(body.tree().getAttribute('rid'))));
        this._throttledRequestHandler();
    }
    /**
     * Attach to an already created and authenticated BOSH session.
     *
     * This function is provided to allow Strophe to attach to BOSH
     * sessions which have been created externally, perhaps by a Web
     * application.  This is often used to support auto-login type features
     * without putting user credentials into the page.
     *
     * @param jid - The full JID that is bound by the session.
     * @param sid - The SID of the BOSH session.
     * @param rid - The current RID of the BOSH session.  This RID
     *     will be used by the next request.
     * @param callback The connect callback function.
     * @param wait - The optional HTTPBIND wait value.  This is the
     *     time the server will wait before returning an empty result for
     *     a request.  The default setting of 60 seconds is recommended.
     *     Other settings will require tweaks to the Strophe.TIMEOUT value.
     * @param hold - The optional HTTPBIND hold value.  This is the
     *     number of connections the server will hold at one time.  This
     *     should almost always be set to 1 (the default).
     * @param wind - The optional HTTBIND window value.  This is the
     *     allowed range of request ids that are valid.  The default is 5.
     */
    _attach(jid, sid, rid, callback, wait, hold, wind) {
        this._conn.jid = jid;
        this.sid = sid;
        this.rid = rid;
        this._conn.connect_callback = callback;
        this._conn.domain = getDomainFromJid(this._conn.jid);
        this._conn.authenticated = true;
        this._conn.connected = true;
        this.wait = wait || this.wait;
        this.hold = hold || this.hold;
        this.window = wind || this.window;
        this._conn._changeConnectStatus(Status.ATTACHED, null);
    }
    /**
     * Attempt to restore a cached BOSH session
     *
     * @param jid - The full JID that is bound by the session.
     *     This parameter is optional but recommended, specifically in cases
     *     where prebinded BOSH sessions are used where it's important to know
     *     that the right session is being restored.
     * @param callback The connect callback function.
     * @param wait - The optional HTTPBIND wait value.  This is the
     *     time the server will wait before returning an empty result for
     *     a request.  The default setting of 60 seconds is recommended.
     *     Other settings will require tweaks to the Strophe.TIMEOUT value.
     * @param hold - The optional HTTPBIND hold value.  This is the
     *     number of connections the server will hold at one time.  This
     *     should almost always be set to 1 (the default).
     * @param wind - The optional HTTBIND window value.  This is the
     *     allowed range of request ids that are valid.  The default is 5.
     */
    _restore(jid, callback, wait, hold, wind) {
        const session = JSON.parse(sessionStorage.getItem('strophe-bosh-session'));
        if (typeof session !== 'undefined' &&
            session !== null &&
            session.rid &&
            session.sid &&
            session.jid &&
            (typeof jid === 'undefined' ||
                jid === null ||
                getBareJidFromJid(session.jid) === getBareJidFromJid(jid) ||
                // If authcid is null, then it's an anonymous login, so
                // we compare only the domains:
                (getNodeFromJid(jid) === null && getDomainFromJid(session.jid) === jid))) {
            this._conn.restored = true;
            this._attach(session.jid, session.sid, session.rid, callback, wait, hold, wind);
        }
        else {
            const error = new Error('_restore: no restoreable session.');
            error.name = 'StropheSessionError';
            throw error;
        }
    }
    /**
     * _Private_ handler for the beforeunload event.
     * This handler is used to process the Bosh-part of the initial request.
     * @private
     */
    _cacheSession() {
        if (this._conn.authenticated) {
            if (this._conn.jid && this.rid && this.sid) {
                sessionStorage.setItem('strophe-bosh-session', JSON.stringify({
                    'jid': this._conn.jid,
                    'rid': this.rid,
                    'sid': this.sid,
                }));
            }
        }
        else {
            sessionStorage.removeItem('strophe-bosh-session');
        }
    }
    /**
     * _Private_ handler for initial connection request.
     * This handler is used to process the Bosh-part of the initial request.
     * @param bodyWrap - The received stanza.
     */
    _connect_cb(bodyWrap) {
        const typ = bodyWrap.getAttribute('type');
        if (typ !== null && typ === 'terminate') {
            // an error occurred
            let cond = bodyWrap.getAttribute('condition');
            log.error('BOSH-Connection failed: ' + cond);
            const conflict = bodyWrap.getElementsByTagName('conflict');
            if (cond !== null) {
                if (cond === 'remote-stream-error' && conflict.length > 0) {
                    cond = 'conflict';
                }
                this._conn._changeConnectStatus(Status.CONNFAIL, cond);
            }
            else {
                this._conn._changeConnectStatus(Status.CONNFAIL, 'unknown');
            }
            this._conn._doDisconnect(cond);
            return Status.CONNFAIL;
        }
        // check to make sure we don't overwrite these if _connect_cb is
        // called multiple times in the case of missing stream:features
        if (!this.sid) {
            this.sid = bodyWrap.getAttribute('sid');
        }
        const wind = bodyWrap.getAttribute('requests');
        if (wind) {
            this.window = parseInt(wind, 10);
        }
        const hold = bodyWrap.getAttribute('hold');
        if (hold) {
            this.hold = parseInt(hold, 10);
        }
        const wait = bodyWrap.getAttribute('wait');
        if (wait) {
            this.wait = parseInt(wait, 10);
        }
        const inactivity = bodyWrap.getAttribute('inactivity');
        if (inactivity) {
            this.inactivity = parseInt(inactivity, 10);
        }
    }
    /**
     * _Private_ part of Connection.disconnect for Bosh
     * @param pres - This stanza will be sent before disconnecting.
     */
    _disconnect(pres) {
        this._sendTerminate(pres);
    }
    /**
     * _Private_ function to disconnect.
     * Resets the SID and RID.
     */
    _doDisconnect() {
        this.sid = null;
        this.rid = Math.floor(Math.random() * 4294967295);
        if (this._conn._sessionCachingSupported()) {
            sessionStorage.removeItem('strophe-bosh-session');
        }
        this._conn.nextValidRid(this.rid);
    }
    /**
     * _Private_ function to check if the Request queue is empty.
     * @returns True, if there are no Requests queued, False otherwise.
     */
    _emptyQueue() {
        return this._requests.length === 0;
    }
    /**
     * _Private_ function to call error handlers registered for HTTP errors.
     * @private
     * @param req - The request that is changing readyState.
     */
    _callProtocolErrorHandlers(req) {
        const reqStatus = Bosh._getRequestStatus(req);
        const err_callback = this._conn.protocolErrorHandlers.HTTP[reqStatus];
        if (err_callback) {
            err_callback.call(this, reqStatus);
        }
    }
    /**
     * _Private_ function to handle the error count.
     *
     * Requests are resent automatically until their error count reaches
     * 5.  Each time an error is encountered, this function is called to
     * increment the count and disconnect if the count is too high.
     * @private
     * @param reqStatus - The request status.
     */
    _hitError(reqStatus) {
        this.errors++;
        log.warn('request errored, status: ' + reqStatus + ', number of errors: ' + this.errors);
        if (this.errors > 4) {
            this._conn._onDisconnectTimeout();
        }
    }
    /**
     * Called on stream start/restart when no stream:features
     * has been received and sends a blank poll request.
     * @param callback
     */
    _no_auth_received(callback) {
        log.warn('Server did not yet offer a supported authentication ' + 'mechanism. Sending a blank poll request.');
        if (callback) {
            callback = callback.bind(this._conn);
        }
        else {
            callback = this._conn._connect_cb.bind(this._conn);
        }
        const body = this._buildBody();
        this._requests.push(new Request(body.tree(), this._onRequestStateChange.bind(this, callback), Number(body.tree().getAttribute('rid'))));
        this._throttledRequestHandler();
    }
    /**
     * _Private_ timeout handler for handling non-graceful disconnection.
     * Cancels all remaining Requests and clears the queue.
     */
    _onDisconnectTimeout() {
        this._abortAllRequests();
    }
    /**
     * _Private_ function that makes sure all pending requests are aborted.
     */
    _abortAllRequests() {
        while (this._requests.length > 0) {
            const req = this._requests.pop();
            req.abort = true;
            req.xhr.abort();
            req.xhr.onreadystatechange = function () { };
        }
    }
    /**
     * _Private_ handler called by {@link Connection#_onIdle|Connection._onIdle()}.
     * Sends all queued Requests or polls with empty Request if there are none.
     */
    _onIdle() {
        const data = this._conn._data;
        // if no requests are in progress, poll
        if (this._conn.authenticated && this._requests.length === 0 && data.length === 0 && !this._conn.disconnecting) {
            log.debug('no requests during idle cycle, sending blank request');
            data.push(null);
        }
        if (this._conn.paused) {
            return;
        }
        if (this._requests.length < 2 && data.length > 0) {
            const body = this._buildBody();
            for (let i = 0; i < data.length; i++) {
                if (data[i] !== null) {
                    if (data[i] === 'restart') {
                        body.attrs({
                            'to': this._conn.domain,
                            'xml:lang': 'en',
                            'xmpp:restart': 'true',
                            'xmlns:xmpp': NS.BOSH,
                        });
                    }
                    else {
                        body.cnode(data[i]).up();
                    }
                }
            }
            delete this._conn._data;
            this._conn._data = [];
            this._requests.push(new Request(body.tree(), this._onRequestStateChange.bind(this, this._conn._dataRecv.bind(this._conn)), Number(body.tree().getAttribute('rid'))));
            this._throttledRequestHandler();
        }
        if (this._requests.length > 0) {
            const time_elapsed = this._requests[0].age();
            if (this._requests[0].dead !== null) {
                if (this._requests[0].timeDead() > Math.floor(timeoutMultiplier * this.wait)) {
                    this._throttledRequestHandler();
                }
            }
            if (time_elapsed > Math.floor(timeoutMultiplier * this.wait)) {
                log.warn('Request ' +
                    this._requests[0].id +
                    ' timed out, over ' +
                    Math.floor(timeoutMultiplier * this.wait) +
                    ' seconds since last activity');
                this._throttledRequestHandler();
            }
        }
    }
    /**
     * Returns the HTTP status code from a {@link Request}
     * @private
     * @param req - The {@link Request} instance.
     * @param def - The default value that should be returned if no status value was found.
     */
    static _getRequestStatus(req, def) {
        let reqStatus;
        if (req.xhr.readyState === 4) {
            try {
                reqStatus = req.xhr.status;
            }
            catch (e) {
                // ignore errors from undefined status attribute. Works
                // around a browser bug
                log.error(`Caught an error while retrieving a request's status, reqStatus: ${reqStatus}, message: ${e.message}`);
            }
        }
        if (typeof reqStatus === 'undefined') {
            reqStatus = typeof def === 'number' ? def : 0;
        }
        return reqStatus;
    }
    /**
     * _Private_ handler for {@link Request} state changes.
     *
     * This function is called when the XMLHttpRequest readyState changes.
     * It contains a lot of error handling logic for the many ways that
     * requests can fail, and calls the request callback when requests
     * succeed.
     * @private
     *
     * @param func - The handler for the request.
     * @param req - The request that is changing readyState.
     */
    _onRequestStateChange(func, req) {
        log.debug('request id ' + req.id + '.' + req.sends + ' state changed to ' + req.xhr.readyState);
        if (req.abort) {
            req.abort = false;
            return;
        }
        if (req.xhr.readyState !== 4) {
            // The request is not yet complete
            return;
        }
        const reqStatus = Bosh._getRequestStatus(req);
        this.lastResponseHeaders = req.xhr.getAllResponseHeaders();
        if (this._conn.disconnecting && reqStatus >= 400) {
            this._hitError(reqStatus);
            this._callProtocolErrorHandlers(req);
            return;
        }
        const reqIs0 = this._requests[0] === req;
        const reqIs1 = this._requests[1] === req;
        const valid_request = reqStatus > 0 && reqStatus < 500;
        const too_many_retries = req.sends > this._conn.maxRetries;
        if (valid_request || too_many_retries) {
            // remove from internal queue
            this._removeRequest(req);
            log.debug('request id ' + req.id + ' should now be removed');
        }
        if (reqStatus === 200) {
            // request succeeded
            // if request 1 finished, or request 0 finished and request
            // 1 is over _TIMEOUT seconds old, we need to
            // restart the other - both will be in the first spot, as the
            // completed request has been removed from the queue already
            if (reqIs1 ||
                (reqIs0 &&
                    this._requests.length > 0 &&
                    this._requests[0].age() > Math.floor(timeoutMultiplier * this.wait))) {
                this._restartRequest(0);
            }
            this._conn.nextValidRid(req.rid + 1);
            log.debug('request id ' + req.id + '.' + req.sends + ' got 200');
            func(req); // call handler
            this.errors = 0;
        }
        else if (reqStatus === 0 || (reqStatus >= 400 && reqStatus < 600) || reqStatus >= 12000) {
            // request failed
            log.error('request id ' + req.id + '.' + req.sends + ' error ' + reqStatus + ' happened');
            this._hitError(reqStatus);
            this._callProtocolErrorHandlers(req);
            if (reqStatus >= 400 && reqStatus < 500) {
                this._conn._changeConnectStatus(Status.DISCONNECTING, null);
                this._conn._doDisconnect();
            }
        }
        else {
            log.error('request id ' + req.id + '.' + req.sends + ' error ' + reqStatus + ' happened');
        }
        if (!valid_request && !too_many_retries) {
            this._throttledRequestHandler();
        }
        else if (too_many_retries && !this._conn.connected) {
            this._conn._changeConnectStatus(Status.CONNFAIL, 'giving-up');
        }
    }
    /**
     * _Private_ function to process a request in the queue.
     *
     * This function takes requests off the queue and sends them and
     * restarts dead requests.
     * @private
     *
     * @param i - The index of the request in the queue.
     */
    _processRequest(i) {
        var _a, _b, _c, _d, _e, _f;
        let req = this._requests[i];
        const reqStatus = Bosh._getRequestStatus(req, -1);
        // make sure we limit the number of retries
        if (req.sends > this._conn.maxRetries) {
            this._conn._onDisconnectTimeout();
            return;
        }
        const time_elapsed = req.age();
        const primary_timeout = !isNaN(time_elapsed) && time_elapsed > Math.floor(timeoutMultiplier * this.wait);
        const secondary_timeout = req.dead !== null && req.timeDead() > Math.floor(secondaryTimeoutMultiplier * this.wait);
        const server_error = req.xhr.readyState === 4 && (reqStatus < 1 || reqStatus >= 500);
        if (primary_timeout || secondary_timeout || server_error) {
            if (secondary_timeout) {
                log.error(`Request ${this._requests[i].id} timed out (secondary), restarting`);
            }
            req.abort = true;
            req.xhr.abort();
            // setting to null fails on IE6, so set to empty function
            req.xhr.onreadystatechange = function () { };
            this._requests[i] = new Request(req.xmlData, req.origFunc, req.rid, req.sends);
            req = this._requests[i];
        }
        if (req.xhr.readyState === 0) {
            log.debug('request id ' + req.id + '.' + req.sends + ' posting');
            try {
                const content_type = this._conn.options.contentType || 'text/xml; charset=utf-8';
                req.xhr.open('POST', this._conn.service, this._conn.options.sync ? false : true);
                if (typeof req.xhr.setRequestHeader !== 'undefined') {
                    // IE9 doesn't have setRequestHeader
                    req.xhr.setRequestHeader('Content-Type', content_type);
                }
                if (this._conn.options.withCredentials) {
                    req.xhr.withCredentials = true;
                }
            }
            catch (e2) {
                log.error('XHR open failed: ' + e2.toString());
                if (!this._conn.connected) {
                    this._conn._changeConnectStatus(Status.CONNFAIL, 'bad-service');
                }
                this._conn.disconnect();
                return;
            }
            // Fires the XHR request -- may be invoked immediately
            // or on a gradually expanding retry window for reconnects
            const sendFunc = () => {
                req.date = new Date().valueOf();
                if (this._conn.options.customHeaders) {
                    const headers = this._conn.options.customHeaders;
                    for (const header in headers) {
                        if (Object.prototype.hasOwnProperty.call(headers, header)) {
                            req.xhr.setRequestHeader(header, headers[header]);
                        }
                    }
                }
                req.xhr.send(req.data);
            };
            // Implement progressive backoff for reconnects --
            // First retry (send === 1) should also be instantaneous
            if (req.sends > 1) {
                // Using a cube of the retry number creates a nicely
                // expanding retry window
                const backoff = Math.min(Math.floor(timeoutMultiplier * this.wait), Math.pow(req.sends, 3)) * 1000;
                setTimeout(function () {
                    // XXX: setTimeout should be called only with function expressions (23974bc1)
                    sendFunc();
                }, backoff);
            }
            else {
                sendFunc();
            }
            req.sends++;
            if (this.strip && req.xmlData.nodeName === 'body' && req.xmlData.childNodes.length) {
                (_b = (_a = this._conn).xmlOutput) === null || _b === void 0 ? void 0 : _b.call(_a, req.xmlData.children[0]);
            }
            else {
                (_d = (_c = this._conn).xmlOutput) === null || _d === void 0 ? void 0 : _d.call(_c, req.xmlData);
            }
            (_f = (_e = this._conn).rawOutput) === null || _f === void 0 ? void 0 : _f.call(_e, req.data);
        }
        else {
            log.debug('_processRequest: ' +
                (i === 0 ? 'first' : 'second') +
                ' request has readyState of ' +
                req.xhr.readyState);
        }
    }
    /**
     * _Private_ function to remove a request from the queue.
     * @private
     * @param req - The request to remove.
     */
    _removeRequest(req) {
        log.debug('removing request');
        for (let i = this._requests.length - 1; i >= 0; i--) {
            if (req === this._requests[i]) {
                this._requests.splice(i, 1);
            }
        }
        // IE6 fails on setting to null, so set to empty function
        req.xhr.onreadystatechange = function () { };
        this._throttledRequestHandler();
    }
    /**
     * _Private_ function to restart a request that is presumed dead.
     * @private
     *
     * @param i - The index of the request in the queue.
     */
    _restartRequest(i) {
        const req = this._requests[i];
        if (req.dead === null) {
            req.dead = new Date();
        }
        this._processRequest(i);
    }
    /**
     * _Private_ function to get a stanza out of a request.
     * Tries to extract a stanza out of a Request Object.
     * When this fails the current connection will be disconnected.
     *
     * @param req - The Request.
     * @returns The stanza that was passed.
     */
    _reqToData(req) {
        try {
            return req.getResponse();
        }
        catch (e) {
            if (e.message !== 'parsererror') {
                throw e;
            }
            this._conn.disconnect('strophe-parsererror');
        }
    }
    /**
     * _Private_ function to send initial disconnect sequence.
     *
     * This is the first step in a graceful disconnect.  It sends
     * the BOSH server a terminate body and includes an unavailable
     * presence if authentication has completed.
     * @private
     * @param pres
     */
    _sendTerminate(pres) {
        log.debug('_sendTerminate was called');
        const body = this._buildBody().attrs({ type: 'terminate' });
        const el = pres instanceof Builder ? pres.tree() : pres;
        if (pres) {
            body.cnode(el);
        }
        const req = new Request(body.tree(), this._onRequestStateChange.bind(this, this._conn._dataRecv.bind(this._conn)), Number(body.tree().getAttribute('rid')));
        this._requests.push(req);
        this._throttledRequestHandler();
    }
    /**
     * _Private_ part of the Connection.send function for BOSH
     * Just triggers the RequestHandler to send the messages that are in the queue
     */
    _send() {
        clearTimeout(this._conn._idleTimeout);
        this._throttledRequestHandler();
        this._conn._idleTimeout = setTimeout(() => this._conn._onIdle(), 100);
    }
    /**
     * Send an xmpp:restart stanza.
     */
    _sendRestart() {
        this._throttledRequestHandler();
        clearTimeout(this._conn._idleTimeout);
    }
    /**
     * _Private_ function to throttle requests to the connection window.
     *
     * This function makes sure we don't send requests so fast that the
     * request ids overflow the connection window in the case that one
     * request died.
     * @private
     */
    _throttledRequestHandler() {
        if (!this._requests) {
            log.debug('_throttledRequestHandler called with ' + 'undefined requests');
        }
        else {
            log.debug('_throttledRequestHandler called with ' + this._requests.length + ' requests');
        }
        if (!this._requests || this._requests.length === 0) {
            return;
        }
        if (this._requests.length > 0) {
            this._processRequest(0);
        }
        if (this._requests.length > 1 && Math.abs(this._requests[0].rid - this._requests[1].rid) < this.window) {
            this._processRequest(1);
        }
    }
}

/**
 * _Private_ helper class for managing stanza handlers.
 *
 * A Handler encapsulates a user provided callback function to be
 * executed when matching stanzas are received by the connection.
 * Handlers can be either one-off or persistant depending on their
 * return value. Returning true will cause a Handler to remain active, and
 * returning false will remove the Handler.
 *
 * Users will not use Handler objects directly, but instead they
 * will use {@link Connection.addHandler} and
 * {@link Connection.deleteHandler}.
 */
class Handler {
    /**
     * Create and initialize a new Handler.
     *
     * @param handler - A function to be executed when the handler is run.
     * @param ns - The namespace to match.
     * @param name - The element name to match.
     * @param type - The stanza type (or types if an array) to match.
     * @param id - The element id attribute to match.
     * @param from - The element from attribute to match.
     * @param options - Handler options
     */
    constructor(handler, ns, name, type, id, from, options) {
        this.handler = handler;
        this.ns = ns;
        this.name = name;
        this.type = type;
        this.id = id;
        this.options = options || { matchBareFromJid: false, ignoreNamespaceFragment: false };
        if (this.options.matchBareFromJid) {
            this.from = from ? getBareJidFromJid(from) : null;
        }
        else {
            this.from = from;
        }
        this.user = true;
    }
    /**
     * Returns the XML namespace of an element.
     * Resolved via {@link Strophe.getNamespace}, which reads the `xmlns`
     * attribute and falls back to `namespaceURI` so matching works regardless
     * of how the stanza's DOM was built (locally, via DOMParser, or via the
     * component transport's `createElementNS`).
     * If `ignoreNamespaceFragment` was passed in for this handler, then the
     * URL fragment will be stripped.
     * @param elem - The XML element with the namespace.
     * @returns The namespace, with optionally the fragment stripped.
     */
    getNamespace(elem) {
        let elNamespace = getNamespace(elem);
        if (elNamespace && this.options.ignoreNamespaceFragment) {
            elNamespace = elNamespace.split('#')[0];
        }
        return elNamespace;
    }
    /**
     * Tests if a stanza element (or any of its children) matches the
     * namespace set for this Handler.
     * @param elem - The XML element to test.
     * @returns true if the stanza matches and false otherwise.
     */
    namespaceMatch(elem) {
        var _a;
        if (!this.ns || this.getNamespace(elem) === this.ns) {
            return true;
        }
        for (const child of (_a = elem.children) !== null && _a !== void 0 ? _a : []) {
            if (this.getNamespace(child) === this.ns) {
                return true;
            }
            else if (this.namespaceMatch(child)) {
                return true;
            }
        }
        return false;
    }
    /**
     * Tests if a stanza matches the Handler.
     * @param elem - The XML element to test.
     * @returns true if the stanza matches and false otherwise.
     */
    isMatch(elem) {
        let from = elem.getAttribute('from');
        if (this.options.matchBareFromJid) {
            from = getBareJidFromJid(from);
        }
        const elem_type = elem.getAttribute('type');
        if (this.namespaceMatch(elem) &&
            (!this.name || isTagEqual(elem, this.name)) &&
            (!this.type ||
                (Array.isArray(this.type) ? this.type.indexOf(elem_type !== null && elem_type !== void 0 ? elem_type : '') !== -1 : elem_type === this.type)) &&
            (!this.id || elem.getAttribute('id') === this.id) &&
            (!this.from || from === this.from)) {
            return true;
        }
        return false;
    }
    /**
     * Run the callback on a matching stanza.
     * @param elem - The DOM element that triggered the Handler.
     * @returns A boolean indicating if the handler should remain active.
     */
    run(elem) {
        let result = null;
        try {
            result = this.handler(elem);
        }
        catch (e) {
            handleError(e);
            throw e;
        }
        return result;
    }
    /**
     * Get a String representation of the Handler object.
     */
    toString() {
        return '{Handler: ' + this.handler + '(' + this.name + ',' + this.id + ',' + this.ns + ')}';
    }
}

/**
 * _Private_ helper class for managing timed handlers.
 *
 * A Strophe.TimedHandler encapsulates a user provided callback that
 * should be called after a certain period of time or at regular
 * intervals.  The return value of the callback determines whether the
 * Strophe.TimedHandler will continue to fire.
 *
 * Users will not use Strophe.TimedHandler objects directly, but instead
 * they will use {@link Strophe.Connection#addTimedHandler|addTimedHandler()} and
 * {@link Strophe.Connection#deleteTimedHandler|deleteTimedHandler()}.
 *
 * @memberof Strophe
 */
class TimedHandler {
    /**
     * Create and initialize a new Strophe.TimedHandler object.
     * @param period - The number of milliseconds to wait before the
     *     handler is called.
     * @param handler - The callback to run when the handler fires.  This
     *     function should take no arguments.
     */
    constructor(period, handler) {
        this.period = period;
        this.handler = handler;
        this.lastCalled = new Date().getTime();
        this.user = true;
    }
    /**
     * Run the callback for the Strophe.TimedHandler.
     *
     * @returns Returns the result of running the handler,
     *  which is `true` if the Strophe.TimedHandler should be called again,
     *  and `false` otherwise.
     */
    run() {
        this.lastCalled = new Date().getTime();
        return this.handler();
    }
    /**
     * Reset the last called time for the Strophe.TimedHandler.
     */
    reset() {
        this.lastCalled = new Date().getTime();
    }
    /**
     * Get a string representation of the Strophe.TimedHandler object.
     */
    toString() {
        return '{TimedHandler: ' + this.handler + '(' + this.period + ')}';
    }
}

/**
 * Encapsulates an SASL authentication mechanism.
 *
 * User code may override the priority for each mechanism or disable it completely.
 * See <priority> for information about changing priority and <test> for informatian on
 * how to disable a mechanism.
 *
 * By default, all mechanisms are enabled and t_he priorities are
 *
 *     SCRAM-SHA-512 - 72
 *     SCRAM-SHA-384 - 71
 *     SCRAM-SHA-256 - 70
 *     SCRAM-SHA-1   - 60
 *     PLAIN         - 50
 *     OAUTHBEARER   - 40
 *     X-OAUTH2      - 30
 *     ANONYMOUS     - 20
 *     EXTERNAL      - 10
 *
 * See: {@link Strophe.Connection#registerSASLMechanisms}
 */
class SASLMechanism {
    /**
     * PrivateConstructor: Strophe.SASLMechanism
     * SASL auth mechanism abstraction.
     * @param name - SASL Mechanism name.
     * @param isClientFirst - If client should send response first without challenge.
     * @param priority - Priority.
     */
    constructor(name, isClientFirst, priority) {
        this.mechname = name;
        this.isClientFirst = isClientFirst;
        this.priority = priority;
        this._connection = null;
    }
    /**
     * Checks if mechanism able to run.
     * To disable a mechanism, make this return false;
     *
     * To disable plain authentication run
     * > Strophe.SASLPlain.test = function() {
     * >   return false;
     * > }
     *
     * See <SASL mechanisms> for a list of available mechanisms.
     * @param _connection - Target Connection.
     * @returns If mechanism was able to run.
     */
    test(_connection) {
        return true;
    }
    /**
     * Called before starting mechanism on some connection.
     * @param connection - Target Connection.
     */
    onStart(connection) {
        this._connection = connection;
    }
    /**
     * Called by protocol implementation on incoming challenge.
     *
     * By deafult, if the client is expected to send data first (isClientFirst === true),
     * this method is called with `challenge` as null on the first call,
     * unless `clientChallenge` is overridden in the relevant subclass.
     * @param _connection - Target Connection.
     * @param _challenge - current challenge to handle.
     * @returns Mechanism response.
     */
    onChallenge(_connection, _challenge) {
        throw new Error('You should implement challenge handling!');
    }
    /**
     * Called by the protocol implementation if the client is expected to send
     * data first in the authentication exchange (i.e. isClientFirst === true).
     * @param connection - Target Connection.
     * @returns Mechanism response.
     */
    clientChallenge(connection) {
        if (!this.isClientFirst) {
            throw new Error('clientChallenge should not be called if isClientFirst is false!');
        }
        return this.onChallenge(connection);
    }
    /**
     * Protocol informs mechanism implementation about SASL failure.
     */
    onFailure() {
        this._connection = null;
    }
    /**
     * Protocol informs mechanism implementation about SASL success.
     */
    onSuccess() {
        this._connection = null;
    }
}

class SASLAnonymous extends SASLMechanism {
    constructor(mechname = 'ANONYMOUS', isClientFirst = false, priority = 20) {
        super(mechname, isClientFirst, priority);
    }
    test(connection) {
        return connection.authcid === null;
    }
}

class SASLExternal extends SASLMechanism {
    constructor(mechname = 'EXTERNAL', isClientFirst = true, priority = 10) {
        super(mechname, isClientFirst, priority);
    }
    onChallenge(connection) {
        return connection.authcid === connection.authzid ? '' : connection.authzid;
    }
}

class SASLOAuthBearer extends SASLMechanism {
    constructor(mechname = 'OAUTHBEARER', isClientFirst = true, priority = 40) {
        super(mechname, isClientFirst, priority);
    }
    test(connection) {
        return connection.pass !== null;
    }
    onChallenge(connection) {
        let auth_str = 'n,';
        if (connection.authcid !== null) {
            auth_str = auth_str + 'a=' + connection.authzid;
        }
        auth_str = auth_str + ',';
        auth_str = auth_str + '\u0001';
        auth_str = auth_str + 'auth=Bearer ';
        auth_str = auth_str + connection.pass;
        auth_str = auth_str + '\u0001';
        auth_str = auth_str + '\u0001';
        return utils.utf16to8(auth_str);
    }
}

class SASLPlain extends SASLMechanism {
    constructor(mechname = 'PLAIN', isClientFirst = true, priority = 50) {
        super(mechname, isClientFirst, priority);
    }
    test(connection) {
        return connection.authcid !== null;
    }
    onChallenge(connection) {
        const { authcid, authzid, domain, pass } = connection;
        if (!domain) {
            throw new Error('SASLPlain onChallenge: domain is not defined!');
        }
        let auth_str = authzid !== `${authcid}@${domain}` ? authzid : '';
        auth_str = auth_str + '\u0000';
        auth_str = auth_str + authcid;
        auth_str = auth_str + '\u0000';
        auth_str = auth_str + pass;
        return utils.utf16to8(auth_str);
    }
}

/**
 * @param authMessage
 * @param clientKey
 * @param hashName
 */
function scramClientProof(authMessage, clientKey, hashName) {
    return __awaiter(this, void 0, void 0, function* () {
        const storedKey = yield crypto.subtle.importKey('raw', yield crypto.subtle.digest(hashName, clientKey), { name: 'HMAC', hash: hashName }, false, ['sign']);
        const clientSignature = yield crypto.subtle.sign('HMAC', storedKey, utils.stringToArrayBuf(authMessage));
        return utils.xorArrayBuffers(clientKey, clientSignature);
    });
}
/**
 * This function parses the information in a SASL SCRAM challenge response,
 * into an object of the form
 * { nonce: String,
 *   salt:  ArrayBuffer,
 *   iter:  Int
 * }
 * Returns undefined on failure.
 * @param challenge
 */
function scramParseChallenge(challenge) {
    let nonce, salt, iter;
    const attribMatch = /([a-z]+)=([^,]+)(,|$)/;
    while (challenge.match(attribMatch)) {
        const matches = challenge.match(attribMatch);
        challenge = challenge.replace(matches[0], '');
        switch (matches[1]) {
            case 'r':
                nonce = matches[2];
                break;
            case 's':
                salt = utils.base64ToArrayBuf(matches[2]);
                break;
            case 'i':
                iter = parseInt(matches[2], 10);
                break;
            case 'm':
                return undefined;
        }
    }
    if (isNaN(iter) || iter < 4096) {
        log.warn('Failing SCRAM authentication because server supplied iteration count < 4096.');
        return undefined;
    }
    if (!salt) {
        log.warn('Failing SCRAM authentication because server supplied incorrect salt.');
        return undefined;
    }
    return { nonce, salt, iter };
}
/**
 * Derive the client and server keys given a string password,
 * a hash name, and a bit length.
 * @param password
 * @param salt
 * @param iter
 * @param hashName
 * @param hashBits
 */
function scramDeriveKeys(password, salt, iter, hashName, hashBits) {
    return __awaiter(this, void 0, void 0, function* () {
        const saltedPasswordBits = yield crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: iter, hash: { name: hashName } }, yield crypto.subtle.importKey('raw', utils.stringToArrayBuf(password), 'PBKDF2', false, ['deriveBits']), hashBits);
        const saltedPassword = yield crypto.subtle.importKey('raw', saltedPasswordBits, { name: 'HMAC', hash: hashName }, false, ['sign']);
        return {
            ck: yield crypto.subtle.sign('HMAC', saltedPassword, utils.stringToArrayBuf('Client Key')),
            sk: yield crypto.subtle.sign('HMAC', saltedPassword, utils.stringToArrayBuf('Server Key')),
        };
    });
}
/**
 * @param authMessage
 * @param sk
 * @param hashName
 */
function scramServerSign(authMessage, sk, hashName) {
    return __awaiter(this, void 0, void 0, function* () {
        const serverKey = yield crypto.subtle.importKey('raw', sk, { name: 'HMAC', hash: hashName }, false, ['sign']);
        return crypto.subtle.sign('HMAC', serverKey, utils.stringToArrayBuf(authMessage));
    });
}
/**
 * Generate an ASCII nonce (not containing the ',' character)
 * @returns
 */
function generate_cnonce() {
    const bytes = new Uint8Array(16);
    return utils.arrayBufToBase64(crypto.getRandomValues(bytes).buffer);
}
const scram = {
    /**
     * Whether the Web Crypto `SubtleCrypto` API that SCRAM relies on is available.
     */
    supported() {
        return typeof crypto !== 'undefined' && typeof crypto.subtle !== 'undefined';
    },
    /**
     * On success, sets
     * connection_sasl_data["server-signature"]
     * and
     * connection._sasl_data.keys
     *
     * The server signature should be verified after this function completes..
     *
     * On failure, returns connection._sasl_failure_cb();
     * @param connection
     * @param challenge
     * @param hashName
     * @param hashBits
     */
    scramResponse(connection, challenge, hashName, hashBits) {
        return __awaiter(this, void 0, void 0, function* () {
            const cnonce = connection._sasl_data.cnonce;
            const challengeData = scramParseChallenge(challenge);
            if (!challengeData || challengeData.nonce.slice(0, cnonce.length) !== cnonce) {
                log.warn('Failing SCRAM authentication because server supplied incorrect nonce.');
                connection._sasl_data = {};
                return connection._sasl_failure_cb(null);
            }
            let clientKey, serverKey;
            const { pass } = connection;
            if (typeof connection.pass === 'string' || connection.pass instanceof String) {
                const keys = yield scramDeriveKeys(pass, challengeData.salt, challengeData.iter, hashName, hashBits);
                clientKey = keys.ck;
                serverKey = keys.sk;
            }
            else if ((pass === null || pass === void 0 ? void 0 : pass.name) === hashName &&
                (pass === null || pass === void 0 ? void 0 : pass.salt) === utils.arrayBufToBase64(challengeData.salt) &&
                (pass === null || pass === void 0 ? void 0 : pass.iter) === challengeData.iter) {
                const { ck, sk } = pass;
                clientKey = utils.base64ToArrayBuf(ck);
                serverKey = utils.base64ToArrayBuf(sk);
            }
            else {
                return connection._sasl_failure_cb(null);
            }
            const clientFirstMessageBare = connection._sasl_data['client-first-message-bare'];
            const serverFirstMessage = challenge;
            const clientFinalMessageBare = `c=biws,r=${challengeData.nonce}`;
            const authMessage = `${clientFirstMessageBare},${serverFirstMessage},${clientFinalMessageBare}`;
            const clientProof = yield scramClientProof(authMessage, clientKey, hashName);
            const serverSignature = yield scramServerSign(authMessage, serverKey, hashName);
            connection._sasl_data['server-signature'] = utils.arrayBufToBase64(serverSignature);
            connection._sasl_data.keys = {
                name: hashName,
                iter: challengeData.iter,
                salt: utils.arrayBufToBase64(challengeData.salt),
                ck: utils.arrayBufToBase64(clientKey),
                sk: utils.arrayBufToBase64(serverKey),
            };
            return `${clientFinalMessageBare},p=${utils.arrayBufToBase64(clientProof)}`;
        });
    },
    /**
     * Returns a string containing the client first message
     * @param connection
     * @param test_cnonce
     */
    clientChallenge(connection, test_cnonce) {
        const cnonce = test_cnonce || generate_cnonce();
        const client_first_message_bare = `n=${connection.authcid},r=${cnonce}`;
        connection._sasl_data.cnonce = cnonce;
        connection._sasl_data['client-first-message-bare'] = client_first_message_bare;
        return utils.utf16to8(`n,,${client_first_message_bare}`);
    },
};

class SASLSHA1 extends SASLMechanism {
    constructor(mechname = 'SCRAM-SHA-1', isClientFirst = true, priority = 60) {
        super(mechname, isClientFirst, priority);
    }
    test(connection) {
        return connection.authcid !== null && scram.supported();
    }
    onChallenge(connection, challenge) {
        return __awaiter(this, void 0, void 0, function* () {
            return yield scram.scramResponse(connection, challenge, 'SHA-1', 160);
        });
    }
    clientChallenge(connection, test_cnonce) {
        return scram.clientChallenge(connection, test_cnonce);
    }
}

class SASLSHA256 extends SASLMechanism {
    constructor(mechname = 'SCRAM-SHA-256', isClientFirst = true, priority = 70) {
        super(mechname, isClientFirst, priority);
    }
    test(connection) {
        return connection.authcid !== null && scram.supported();
    }
    onChallenge(connection, challenge) {
        return __awaiter(this, void 0, void 0, function* () {
            return yield scram.scramResponse(connection, challenge, 'SHA-256', 256);
        });
    }
    clientChallenge(connection, test_cnonce) {
        return scram.clientChallenge(connection, test_cnonce);
    }
}

class SASLSHA384 extends SASLMechanism {
    constructor(mechname = 'SCRAM-SHA-384', isClientFirst = true, priority = 71) {
        super(mechname, isClientFirst, priority);
    }
    test(connection) {
        return connection.authcid !== null && scram.supported();
    }
    onChallenge(connection, challenge) {
        return __awaiter(this, void 0, void 0, function* () {
            return yield scram.scramResponse(connection, challenge, 'SHA-384', 384);
        });
    }
    clientChallenge(connection, test_cnonce) {
        return scram.clientChallenge(connection, test_cnonce);
    }
}

class SASLSHA512 extends SASLMechanism {
    constructor(mechname = 'SCRAM-SHA-512', isClientFirst = true, priority = 72) {
        super(mechname, isClientFirst, priority);
    }
    test(connection) {
        return connection.authcid !== null && scram.supported();
    }
    onChallenge(connection, challenge) {
        return __awaiter(this, void 0, void 0, function* () {
            return yield scram.scramResponse(connection, challenge, 'SHA-512', 512);
        });
    }
    clientChallenge(connection, test_cnonce) {
        return scram.clientChallenge(connection, test_cnonce);
    }
}

class SASLXOAuth2 extends SASLMechanism {
    constructor(mechname = 'X-OAUTH2', isClientFirst = true, priority = 30) {
        super(mechname, isClientFirst, priority);
    }
    test(connection) {
        return connection.pass !== null;
    }
    onChallenge(connection) {
        let auth_str = '\u0000';
        if (connection.authcid !== null) {
            auth_str = auth_str + connection.authzid;
        }
        auth_str = auth_str + '\u0000';
        auth_str = auth_str + connection.pass;
        return utils.utf16to8(auth_str);
    }
}

class SessionError extends Error {
    constructor(message) {
        super(message);
        this.name = 'StropheSessionError';
    }
}

/**
 * Helper class that handles WebSocket Connections
 *
 * The WebSocket class is used internally by Connection
 * to encapsulate WebSocket sessions. It is not meant to be used from user's code.
 */
class Websocket {
    /**
     * Create and initialize a WebSocket object.
     * Currently only sets the connection Object.
     * @param connection - The Connection that will use WebSockets.
     */
    constructor(connection) {
        this._conn = connection;
        this.strip = 'wrapper';
        const service = connection.service;
        if (service.indexOf('ws:') !== 0 && service.indexOf('wss:') !== 0) {
            let new_service = '';
            if (connection.options.protocol === 'ws' && location.protocol !== 'https:') {
                new_service += 'ws';
            }
            else {
                new_service += 'wss';
            }
            new_service += '://' + location.host;
            if (service.indexOf('/') !== 0) {
                new_service += location.pathname + service;
            }
            else {
                new_service += service;
            }
            connection.service = new_service;
        }
    }
    /**
     * _Private_ helper function to generate the <stream> start tag for WebSockets
     * @private
     * @returns A Builder with a <stream> element.
     */
    _buildStream() {
        return $build('open', {
            'xmlns': NS.FRAMING,
            'to': this._conn.domain,
            'version': '1.0',
        });
    }
    /**
     * _Private_ checks a message for stream:error
     * @private
     * @param bodyWrap - The received stanza.
     * @param connectstatus - The ConnectStatus that will be set on error.
     * @returns true if there was a streamerror, false otherwise.
     */
    _checkStreamError(bodyWrap, connectstatus) {
        let errors;
        if (bodyWrap.getElementsByTagNameNS) {
            errors = bodyWrap.getElementsByTagNameNS(NS.STREAM, 'error');
        }
        else {
            errors = bodyWrap.getElementsByTagName('stream:error');
        }
        if (errors.length === 0) {
            return false;
        }
        const error = errors[0];
        let condition = '';
        let text = '';
        const ns = 'urn:ietf:params:xml:ns:xmpp-streams';
        for (let i = 0; i < error.childNodes.length; i++) {
            const e = error.childNodes[i];
            if (e.nodeType === e.ELEMENT_NODE) {
                const el = e;
                if (el.getAttribute('xmlns') !== ns) {
                    break;
                }
            }
            if (e.nodeName === 'text') {
                text = e.textContent || '';
            }
            else {
                condition = e.nodeName;
            }
        }
        let errorString = 'WebSocket stream error: ';
        if (condition) {
            errorString += condition;
        }
        else {
            errorString += 'unknown';
        }
        if (text) {
            errorString += ' - ' + text;
        }
        log.error(errorString);
        this._conn._changeConnectStatus(connectstatus, condition);
        this._conn._doDisconnect();
        return true;
    }
    /**
     * Reset the connection.
     *
     * This function is called by the reset function of the Strophe Connection.
     * Is not needed by WebSockets.
     */
    _reset() {
        return;
    }
    /**
     * _Private_ function called by Connection.connect
     *
     * Creates a WebSocket for a connection and assigns Callbacks to it.
     * Does nothing if there already is a WebSocket.
     */
    _connect() {
        this._closeSocket();
        this.socket = new WebSocket(this._conn.service, 'xmpp');
        this.socket.onopen = () => this._onOpen();
        this.socket.onerror = (e) => this._onError(e);
        this.socket.onclose = (e) => this._onClose(e);
        this.socket.onmessage = (message) => this._onInitialMessage(message);
    }
    /**
     * _Private_ function called by Connection._connect_cb
     * checks for stream:error
     * @param bodyWrap - The received stanza.
     */
    _connect_cb(bodyWrap) {
        const error = this._checkStreamError(bodyWrap, Status.CONNFAIL);
        if (error) {
            return Status.CONNFAIL;
        }
    }
    /**
     * _Private_ function that checks the opening <open /> tag for errors.
     *
     * Disconnects if there is an error and returns false, true otherwise.
     * @private
     * @param message - Stanza containing the <open /> tag.
     */
    _handleStreamStart(message) {
        let error = null;
        const ns = message.getAttribute('xmlns');
        if (typeof ns !== 'string') {
            error = 'Missing xmlns in <open />';
        }
        else if (ns !== NS.FRAMING) {
            error = 'Wrong xmlns in <open />: ' + ns;
        }
        const ver = message.getAttribute('version');
        if (typeof ver !== 'string') {
            error = 'Missing version in <open />';
        }
        else if (ver !== '1.0') {
            error = 'Wrong version in <open />: ' + ver;
        }
        if (error) {
            this._conn._changeConnectStatus(Status.CONNFAIL, error);
            this._conn._doDisconnect();
            return false;
        }
        return true;
    }
    /**
     * _Private_ function that handles the first connection messages.
     *
     * On receiving an opening stream tag this callback replaces itself with the real
     * message handler. On receiving a stream error the connection is terminated.
     * @param message
     */
    _onInitialMessage(message) {
        if (message.data.indexOf('<open ') === 0 || message.data.indexOf('<?xml') === 0) {
            const data = message.data.replace(/^(<\?.*?\?>\s*)*/, '');
            if (data === '')
                return;
            const streamStart = new DOMParser().parseFromString(data, 'text/xml').documentElement;
            this._conn.xmlInput(streamStart);
            this._conn.rawInput(message.data);
            if (this._handleStreamStart(streamStart)) {
                this._connect_cb(streamStart);
            }
        }
        else if (message.data.indexOf('<close ') === 0) {
            const parsedMessage = new DOMParser().parseFromString(message.data, 'text/xml').documentElement;
            this._conn.xmlInput(parsedMessage);
            this._conn.rawInput(message.data);
            const see_uri = parsedMessage.getAttribute('see-other-uri');
            if (see_uri) {
                const service = this._conn.service;
                const isSecureRedirect = (service.indexOf('wss:') >= 0 && see_uri.indexOf('wss:') >= 0) || service.indexOf('ws:') >= 0;
                if (isSecureRedirect) {
                    this._conn._changeConnectStatus(Status.REDIRECT, 'Received see-other-uri, resetting connection');
                    this._conn.reset();
                    this._conn.service = see_uri;
                    this._connect();
                }
            }
            else {
                this._conn._changeConnectStatus(Status.CONNFAIL, 'Received closing stream');
                this._conn._doDisconnect();
            }
        }
        else {
            this._replaceMessageHandler();
            const string = this._streamWrap(message.data);
            const elem = new DOMParser().parseFromString(string, 'text/xml').documentElement;
            this._conn._connect_cb(elem, null, message.data);
        }
    }
    /**
     * Called by _onInitialMessage in order to replace itself with the general message handler.
     * This method is overridden by WorkerWebsocket, which manages a
     * websocket connection via a service worker and doesn't have direct access
     * to the socket.
     */
    _replaceMessageHandler() {
        this.socket.onmessage = (m) => this._onMessage(m);
    }
    /**
     * _Private_ function called by Connection.disconnect
     * Disconnects and sends a last stanza if one is given
     * @param pres - This stanza will be sent before disconnecting.
     */
    _disconnect(pres) {
        if (this.socket && this.socket.readyState !== WebSocket.CLOSED) {
            if (pres) {
                this._conn.send(pres);
            }
            const close = $build('close', { 'xmlns': NS.FRAMING });
            this._conn.xmlOutput(close.tree());
            const closeString = Builder.serialize(close);
            this._conn.rawOutput(closeString);
            try {
                this.socket.send(closeString);
            }
            catch (e) {
                log.warn(`Couldn't send <close /> tag. "${e.message}"`);
            }
        }
        setTimeout(() => this._conn._doDisconnect(), 0);
    }
    /**
     * _Private_ function to disconnect.
     * Just closes the Socket for WebSockets
     */
    _doDisconnect() {
        log.debug('WebSockets _doDisconnect was called');
        this._closeSocket();
    }
    /**
     * PrivateFunction _streamWrap
     * _Private_ helper function to wrap a stanza in a <stream> tag.
     * This is used so Strophe can process stanzas from WebSockets like BOSH
     * @param stanza
     */
    _streamWrap(stanza) {
        return '<wrapper>' + stanza + '</wrapper>';
    }
    /**
     * _Private_ function to close the WebSocket.
     *
     * Closes the socket if it is still open and deletes it
     */
    _closeSocket() {
        if (this.socket) {
            try {
                this.socket.onclose = null;
                this.socket.onerror = null;
                this.socket.onmessage = null;
                this.socket.close();
            }
            catch (e) {
                log.debug(e.message);
            }
        }
        this.socket = null;
    }
    /**
     * _Private_ function to check if the message queue is empty.
     * @returns True, because WebSocket messages are send immediately after queueing.
     */
    _emptyQueue() {
        return true;
    }
    /**
     * _Private_ function to handle websockets closing.
     * @param e
     */
    _onClose(e) {
        if (this._conn.connected && !this._conn.disconnecting) {
            log.error('Websocket closed unexpectedly');
            this._conn._doDisconnect();
        }
        else if (e && e.code === 1006 && !this._conn.connected && this.socket) {
            log.error('Websocket closed unexcectedly');
            this._conn._changeConnectStatus(Status.CONNFAIL, 'The WebSocket connection could not be established or was disconnected.');
            this._conn._doDisconnect();
        }
        else {
            log.debug('Websocket closed');
        }
    }
    /**
     * Called on stream start/restart when no stream:features
     * has been received.
     * @param callback
     */
    _no_auth_received(callback) {
        log.error('Server did not offer a supported authentication mechanism');
        this._conn._changeConnectStatus(Status.CONNFAIL, ErrorCondition.NO_AUTH_MECH);
        callback === null || callback === void 0 ? void 0 : callback.call(this._conn);
        this._conn._doDisconnect();
    }
    /**
     * _Private_ timeout handler for handling non-graceful disconnection.
     *
     * This does nothing for WebSockets
     */
    _onDisconnectTimeout() { }
    /**
     * _Private_ helper function that makes sure all pending requests are aborted.
     */
    _abortAllRequests() { }
    /**
     * _Private_ function to handle websockets errors.
     * @param error - The websocket error.
     */
    _onError(error) {
        log.error('Websocket error ' + JSON.stringify(error));
        this._conn._changeConnectStatus(Status.CONNFAIL, 'The WebSocket connection could not be established or was disconnected.');
        this._disconnect();
    }
    /**
     * _Private_ function called by Connection._onIdle
     * sends all queued stanzas
     */
    _onIdle() {
        const data = this._conn._data;
        if (data.length > 0 && !this._conn.paused) {
            for (let i = 0; i < data.length; i++) {
                if (data[i] !== null) {
                    const stanza = data[i] === 'restart' ? this._buildStream().tree() : data[i];
                    if (stanza === 'restart')
                        throw new Error('Wrong type for stanza');
                    const rawStanza = Builder.serialize(stanza);
                    this._conn.xmlOutput(stanza);
                    this._conn.rawOutput(rawStanza);
                    this.socket.send(rawStanza);
                }
            }
            this._conn._data = [];
        }
    }
    /**
     * _Private_ function to handle websockets messages.
     *
     * This function parses each of the messages as if they are full documents.
     * [TODO : We may actually want to use a SAX Push parser].
     *
     * Since all XMPP traffic starts with
     * <stream:stream version='1.0'
     *                xml:lang='en'
     *                xmlns='jabber:client'
     *                xmlns:stream='http://etherx.jabber.org/streams'
     *                id='3697395463'
     *                from='SERVER'>
     *
     * The first stanza will always fail to be parsed.
     *
     * Additionally, the seconds stanza will always be <stream:features> with
     * the stream NS defined in the previous stanza, so we need to 'force'
     * the inclusion of the NS in this stanza.
     *
     * @param message - The websocket message event
     */
    _onMessage(message) {
        let elem;
        const close = '<close xmlns="urn:ietf:params:xml:ns:xmpp-framing" />';
        if (message.data === close) {
            this._conn.rawInput(close);
            this._conn.xmlInput(message);
            if (!this._conn.disconnecting) {
                this._conn._doDisconnect();
            }
            return;
        }
        else if (message.data.search('<open ') === 0) {
            elem = new DOMParser().parseFromString(message.data, 'text/xml').documentElement;
            if (!this._handleStreamStart(elem)) {
                return;
            }
        }
        else {
            const data = this._streamWrap(message.data);
            elem = new DOMParser().parseFromString(data, 'text/xml').documentElement;
        }
        if (this._checkStreamError(elem, Status.ERROR)) {
            return;
        }
        if (this._conn.disconnecting &&
            elem.firstElementChild.nodeName === 'presence' &&
            elem.firstElementChild.getAttribute('type') === 'unavailable') {
            this._conn.xmlInput(elem);
            this._conn.rawInput(Builder.serialize(elem));
            return;
        }
        this._conn._dataRecv(elem, message.data);
    }
    /**
     * _Private_ function to handle websockets connection setup.
     * The opening stream tag is sent here.
     * @private
     */
    _onOpen() {
        log.debug('Websocket open');
        const start = this._buildStream();
        this._conn.xmlOutput(start.tree());
        const startString = Builder.serialize(start);
        this._conn.rawOutput(startString);
        this.socket.send(startString);
    }
    /**
     * _Private_ part of the Connection.send function for WebSocket
     * Just flushes the messages that are in the queue
     */
    _send() {
        this._conn.flush();
    }
    /**
     * Send an xmpp:restart stanza.
     */
    _sendRestart() {
        clearTimeout(this._conn._idleTimeout);
        this._conn._onIdle.bind(this._conn)();
    }
}

/**
 * Helper class that handles a websocket connection inside a shared worker.
 */
class WorkerWebsocket extends Websocket {
    /**
     * Create and initialize a WorkerWebsocket object.
     * @param connection - The Connection
     */
    constructor(connection) {
        super(connection);
        this._conn = connection;
        this._initWorker();
    }
    /**
     * (Re)create the SharedWorker. Called for every connection attempt: if
     * the worker for this URL is still running, the browser just opens
     * another port to it (the previous port is said goodbye to and closed),
     * but if it terminated (it shuts itself down when it detects a page from
     * a newer build, and the browser reclaims it when the last tab goes away
     * or it crashes), a fresh worker running the *current* script is
     * spawned. Ports to a dead worker fail silently, so re-creating per
     * attempt is the only reliable way to recover from worker death.
     */
    _initWorker() {
        if (this.worker) {
            this.worker.port.postMessage(['_bye']);
            this.worker.port.close();
        }
        this.worker = new SharedWorker(this._conn.options.worker, 'Strophe XMPP Connection');
        this.worker.onerror = (e) => {
            console === null || console === void 0 ? void 0 : console.error(e);
            log.error(`Shared Worker Error: ${e}`);
        };
    }
    /**
     * @private
     */
    _setSocket() {
        this.socket = {
            send: (str) => this.worker.port.postMessage(['send', str]),
            close: () => this.worker.port.postMessage(['_closeSocket']),
            onopen: () => { },
            onerror: (e) => this._onError(e),
            onclose: (e) => this._onClose(e),
            onmessage: () => { },
            readyState: null,
        };
    }
    _connect() {
        this._initWorker();
        this._setSocket();
        this._messageHandler = (m) => this._onInitialMessage(m);
        this.worker.port.start();
        this.worker.port.onmessage = (ev) => this._onWorkerMessage(ev);
        this.worker.port.postMessage(['_connect', this._conn.service, this._conn.jid, SHARED_WORKER_PROTOCOL_VERSION]);
        this._attachLifecycleListeners();
    }
    /**
     * @param callback
     */
    _attach(callback) {
        this._initWorker();
        this._setSocket();
        this._messageHandler = (m) => this._onMessage(m);
        this._conn.connect_callback = callback;
        this.worker.port.start();
        this.worker.port.onmessage = (ev) => this._onWorkerMessage(ev);
        this.worker.port.postMessage(['_attach', this._conn.service, SHARED_WORKER_PROTOCOL_VERSION]);
        this._attachLifecycleListeners();
    }
    /**
     * Called by the worker to assign this tab's role. A secondary shares the
     * already-established session, so it must not treat inbound frames as its
     * own connection handshake.
     * @param role
     * @param jid - The shared connection's JID.
     */
    _role(role, jid) {
        this._conn.role = role;
        if (role === 'secondary') {
            this._messageHandler = (m) => this._onMessage(m);
            if (jid)
                this._conn.jid = jid;
        }
        this._conn.onRoleChanged(role);
    }
    /**
     * Called by the worker when this tab is promoted to primary after the
     * previous primary went away. Same socket — no reconnect happens.
     * @param jid - The shared connection's JID.
     */
    _promote(jid) {
        this._conn.role = 'primary';
        if (jid)
            this._conn.jid = jid;
        this._conn.onRoleChanged('primary');
    }
    /**
     * Ask the worker to negotiate XEP-0198 for the freshly authenticated
     * stream (§2.3): it sends <resume/> if it holds resumable state,
     * otherwise it replies with _smNoState and the connection proceeds to
     * bind a resource.
     */
    _smFeatures() {
        this.worker.port.postMessage(['_smFeatures']);
    }
    /**
     * Report that the connect flow completed (resource bound, or legacy
     * auth/session establishment finished). Sent with or without SM: the
     * worker adopts the bound JID as the shared one, releases tabs parked on
     * the handshake, and starts a fresh SM session itself when this stream's
     * features advertised support.
     * @param jid - The server-assigned full JID.
     */
    _bound(jid) {
        this.worker.port.postMessage(['_bound', jid]);
    }
    /**
     * Liveness probe from the worker. Answered from this message handler —
     * which runs even when the browser throttles this tab's timers — so a
     * merely-backgrounded tab never looks dead to the worker.
     */
    _ping() {
        this.worker.port.postMessage(['_pong']);
    }
    /**
     * Called by the worker when another tab sent a message or presence
     * stanza over the shared connection. Handed to its own overridable hook
     * — never into the inbound pipeline (_dataRecv), where it would hit
     * stanza handlers, SM counting and xmlInput as if it were received
     * traffic.
     * @param data - The serialized stanza.
     */
    _onStanzaSent(data) {
        this._conn.onForeignStanzaSent(toElement(data));
    }
    /**
     * Called by the worker when it has no resumable state: continue the
     * connect flow with resource binding.
     */
    _smNoState() {
        this._conn._proceedToBind();
    }
    /**
     * Called by the worker when a fresh SM session was established.
     * @param id - The SM-ID.
     * @param max - The server's preferred maximum resumption time.
     * @param boundJid - The JID that was bound when the session was enabled.
     */
    _smEnabled(id, max, boundJid) {
        var _a;
        (_a = this._conn.sm) === null || _a === void 0 ? void 0 : _a._onEnabled(id, max, boundJid);
    }
    /**
     * Called by the worker when the previous session was resumed. Every tab
     * adopts the originally bound JID; the primary — which drove the connect
     * flow — additionally restores the connection state and emits CONNECTED
     * (the same actions a non-worker connection applies on <resumed/>).
     * @param jid - The worker's boundJid.
     * @param id - The SM-ID of the resumed session.
     * @param max - The server's preferred maximum resumption time.
     */
    _smResumed(jid, id, max) {
        var _a;
        const conn = this._conn;
        (_a = conn.sm) === null || _a === void 0 ? void 0 : _a._onResumed(jid, id, max);
        conn.jid = jid;
        if (conn.role === 'primary') {
            conn.do_bind = false;
            conn.authenticated = true;
            conn.restored = true;
            conn._changeConnectStatus(Status.CONNECTED, null);
        }
    }
    /**
     * Called by the worker when resumption failed: the primary falls back
     * to binding a resource on this same stream (the salvaged queue stays
     * in the worker and is re-sent after the next <enabled/>).
     */
    _smFailed() {
        var _a;
        const conn = this._conn;
        (_a = conn.sm) === null || _a === void 0 ? void 0 : _a._onFailed();
        if (conn.role === 'primary') {
            conn.do_bind = true;
            conn._proceedToBind();
        }
    }
    /**
     * Wire the page lifecycle into the worker's port bookkeeping: `_bye` on
     * pagehide (graceful removal + failover), `_relinquish` on freeze (hand
     * the primary role over *before* this tab's CPU stops), and a `_pong`
     * when the page comes back (which also re-admits this port if the worker
     * dropped it while we were away). Routine liveness is worker-driven
     * ping/pong (see {@link WorkerWebsocket#_ping}) — deliberately no
     * page-side timers, because hidden tabs may only run timers once every
     * ten minutes.
     */
    _attachLifecycleListeners() {
        if (this._lifecycleAttached || typeof window === 'undefined') {
            return;
        }
        window.addEventListener('pagehide', () => this.worker.port.postMessage(['_bye']));
        window.addEventListener('pageshow', () => this.worker.port.postMessage(['_pong']));
        document.addEventListener('freeze', () => this.worker.port.postMessage(['_relinquish']));
        document.addEventListener('resume', () => this.worker.port.postMessage(['_pong']));
        this._lifecycleAttached = true;
    }
    /**
     * Called when the worker reports that the shared socket closed or died.
     * Unlike a page-owned websocket this can arrive while this tab believes
     * it is still connecting. The worker owns the socket, and e.g. its
     * connection attempt to the server can fail. The base implementation
     * ignores closes in that state (it only knows real CloseEvents), which
     * would leave this tab stuck in CONNECTING forever, so fail the
     * connection attempt instead: the embedder's reconnect logic takes it
     * from there.
     * @param e - The close reason from the worker, or a close event.
     */
    _onClose(e) {
        if (this._conn.connected && !this._conn.disconnecting) {
            log.error('Websocket closed unexpectedly');
            this._conn._doDisconnect();
        }
        else if (!this._conn.connected && !this._conn.disconnecting) {
            const reason = typeof e === 'string' ? e : 'The shared websocket connection could not be established or was lost.';
            log.error(`Shared websocket closed while connecting: ${reason}`);
            this._conn._changeConnectStatus(Status.CONNFAIL, reason);
            this._conn._doDisconnect();
        }
        else {
            log.debug('Websocket closed');
        }
    }
    /**
     * @param status
     * @param jid
     */
    _attachCallback(status, jid, _condition) {
        if (status === Status.ATTACHED) {
            this._conn.jid = jid;
            this._conn.authenticated = true;
            this._conn.connected = true;
            this._conn.restored = true;
            this._conn._changeConnectStatus(Status.ATTACHED);
        }
        else if (status === Status.ATTACHFAIL) {
            this._conn.authenticated = false;
            this._conn.connected = false;
            this._conn.restored = false;
            this._conn._changeConnectStatus(Status.ATTACHFAIL);
        }
    }
    /**
     * @param pres - This stanza will be sent before disconnecting.
     */
    _disconnect(pres) {
        pres && this._conn.send(pres);
        const close = $build('close', { 'xmlns': NS.FRAMING });
        this._conn.xmlOutput(close.tree());
        const closeString = Builder.serialize(close);
        this._conn.rawOutput(closeString);
        this.worker.port.postMessage(['send', closeString]);
        this._conn._doDisconnect();
    }
    _closeSocket() {
        this.socket.close();
    }
    /**
     * Called by _onInitialMessage in order to replace itself with the general message handler.
     * This method is overridden by WorkerWebsocket, which manages a
     * websocket connection via a service worker and doesn't have direct access
     * to the socket.
     */
    _replaceMessageHandler() {
        this._messageHandler = (m) => this._onMessage(m);
    }
    /**
     * function that handles messages received from the service worker
     * @private
     * @param ev
     */
    _onWorkerMessage(ev) {
        const { data } = ev;
        const method_name = data[0];
        if (method_name === '_onMessage') {
            this._messageHandler(data[1]);
        }
        else if (method_name in this) {
            try {
                this[method_name].apply(this, ev.data.slice(1));
            }
            catch (e) {
                log.error(String(e));
            }
        }
        else if (method_name === 'log') {
            const lmap = {
                debug: LOG_LEVELS.DEBUG,
                info: LOG_LEVELS.INFO,
                warn: LOG_LEVELS.WARN,
                error: LOG_LEVELS.ERROR,
                fatal: LOG_LEVELS.FATAL,
            };
            const level = data[1];
            const msg = data[2];
            log.log(lmap[level], msg);
        }
        else {
            log.error(`Found unhandled service worker message: ${data}`);
        }
    }
}

/**
 * XEP-0198 Stream Management
 *
 * Environment-free helpers.
 *
 * IMPORTANT: this module must be loadable in a SharedWorker global (it is
 * bundled into dist/shared-connection-worker.js), so keep it free of imports
 * beyond constants (no ../utils.ts or ../builder.ts, and no *module-level DOM access).
 */
/** The 'h' counter is an unsignedInt that wraps back to zero (XEP-0198 §4). */
const H_WRAP = 2 ** 32;
/** Stanza names that count towards the 'h' counters (XEP-0198 §4). */
const COUNTABLE = ['iq', 'presence', 'message'];
/**
 * Escapes invalid xml characters (duplicated from ../utils.ts so the worker
 * bundle doesn't pull in utils and its dependencies).
 * @param text
 */
function xmlEscape(text) {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/'/g, '&apos;')
        .replace(/"/g, '&quot;');
}
/**
 * @returns A fresh, inactive SM state object.
 */
function freshState() {
    return {
        boundJid: null,
        enableSent: false,
        enabled: false,
        hIn: 0,
        hOutAcked: 0,
        id: null,
        location: null,
        max: null,
        resumeSupported: false,
        resumed: false,
        sinceLastAck: 0,
        unacked: [],
    };
}
/**
 * Parse an 'h' attribute value into a wrapped unsigned 32-bit counter value.
 * @param value - The attribute value (may be undefined).
 * @returns The parsed value, or null if missing or invalid.
 */
function parseH(value) {
    if (typeof value !== 'string')
        return null;
    const h = parseInt(value, 10);
    return Number.isNaN(h) || h < 0 ? null : h % H_WRAP;
}
/**
 * @param name - A top-level element's local tag name.
 * @returns true if the element counts towards the SM 'h' counters.
 */
function isCountableStanza(name) {
    return COUNTABLE.includes(name);
}
/**
 * Remove the `from` attribute from a serialized stanza's root element, so a
 * re-sent stanza cannot carry a stale resource after a failed resumption. Only
 * the root opening tag is touched; nested `from` attributes (forwarded stanzas,
 * MUC addresses) are preserved. The server stamps the authoritative c2s `from`.
 * DOM-free string surgery, mirroring stampDelay.
 * @param serialized - The serialized stanza.
 * @returns The stanza with the root `from` removed (unchanged if none).
 */
function stripFrom(serialized) {
    const end = serialized.indexOf('>');
    if (end === -1) {
        return serialized;
    }
    const openTag = serialized.slice(0, end);
    const rest = serialized.slice(end);
    // Values cannot contain their own delimiter quote (the serializer escapes it),
    // so a non-greedy match to the matching quote is safe. The leading \s is
    // consumed too, leaving no double space. Only the first (root) from is removed.
    const stripped = openTag.replace(/\sfrom=(["'])[\s\S]*?\1/, '');
    return stripped === openTag ? serialized : stripped + rest;
}
/**
 * Insert a XEP-0203 <delay/> child into a serialized stanza (DOM-free string
 * surgery). Used when re-sending salvaged stanzas after a failed resumption,
 * so the receiving client can show the original send time.
 * @param serialized - The serialized stanza.
 * @param name - The stanza's local tag name.
 * @param queuedAt - The original queueing time (ms since epoch).
 * @returns The stanza with a <delay/> child, or the unmodified input if it
 *     already carries one (or is malformed).
 */
function stampDelay(serialized, name, queuedAt) {
    if (serialized.includes(NS.DELAY)) {
        return serialized;
    }
    const delay = `<delay xmlns="${NS.DELAY}" stamp="${new Date(queuedAt).toISOString()}"/>`;
    if (serialized.endsWith('/>')) {
        return `${serialized.slice(0, -2)}>${delay}</${name}>`;
    }
    const idx = serialized.lastIndexOf(`</${name}`);
    if (idx === -1) {
        return serialized;
    }
    return serialized.slice(0, idx) + delay + serialized.slice(idx);
}

/**
 * XEP-0198 Stream Management
 *
 * Storage backends for resumable session state.
 *
 * MemoryStorageBackend is environment-free and safe in the worker bundle.
 * SessionStorageBackend requires a browser page context, but only at
 * construction time, there is no module-level DOM access here.
 */
/**
 * In-memory storage backend (Node, tests, or non-resumable setups).
 * State is serialized on save so callers can't mutate stored state by reference.
 */
class MemoryStorageBackend {
    constructor() {
        this.store = new Map();
    }
    /**
     * @param key
     */
    load(key) {
        const stored = this.store.get(key);
        return stored ? JSON.parse(stored) : null;
    }
    /**
     * @param key
     * @param state
     */
    save(key, state) {
        this.store.set(key, JSON.stringify(state));
    }
    /**
     * @param key
     */
    clear(key) {
        this.store.delete(key);
    }
}
/**
 * sessionStorage-backed storage backend (browser pages).
 * Survives page reloads within a tab, which is exactly the resumption window.
 */
class SessionStorageBackend {
    constructor() {
        if (typeof sessionStorage === 'undefined') {
            throw new Error('SessionStorageBackend requires a sessionStorage global (browser page context)');
        }
    }
    /**
     * @param key
     */
    load(key) {
        const stored = sessionStorage.getItem(key);
        if (!stored)
            return null;
        try {
            return JSON.parse(stored);
        }
        catch (e) {
            log.warn(`Discarding unparseable SM state for ${key}: ${e.message}`);
            return null;
        }
    }
    /**
     * @param key
     * @param state
     */
    save(key, state) {
        sessionStorage.setItem(key, JSON.stringify(state));
    }
    /**
     * @param key
     */
    clear(key) {
        sessionStorage.removeItem(key);
    }
}

/**
 * XEP-0198 Stream Management engine.
 *
 * This class holds all SM state and logic (counters, the unacked queue, the
 * enable/resume lifecycle) and never touches a DOM Element or a raw websocket
 * frame, so the same class can be hosted by a page-side Connection or inside a
 * SharedWorker. Everything it needs from a stanza is captured in a minimal
 * {@link StanzaView}, produced by whichever side hosts it (dom.ts on the page,
 * parse.ts in the worker). Nonzas are emitted as strings through the injected
 * `sendRaw` function.
 *
 * IMPORTANT: this module must be loadable in a SharedWorker global (it is
 * bundled into dist/shared-connection-worker.js), so keep it free of imports
 * beyond log/constants and its worker-safe siblings, in particular no
 * ../utils.ts or ../builder.ts, and no module-level DOM access.
 */
/**
 * The XEP-0198 Stream Management engine.
 *
 * Hosted by {@link Connection} (page) or by the shared-connection worker; fed
 * {@link StanzaView}s by a thin per-environment adapter. Emits nonzas through
 * the injected `sendRaw` function.
 */
class StreamManagement {
    /**
     * @param sendRaw - Emits a serialized nonza (or re-sent stanza) towards the server.
     * @param options
     */
    constructor(sendRaw, options = {}) {
        this._sendRaw = sendRaw;
        this._options = Object.assign({ maxUnacked: 5, requestResume: true }, options);
        this._storage = this._options.storage || new MemoryStorageBackend();
        this._storageKey = null;
        this._state = freshState();
        this._resumePending = false;
        this._pendingResend = [];
        this.serverSupported = false;
    }
    /** The live SM state. Treat as read-only outside of tests. */
    get state() {
        return this._state;
    }
    /** Whether <enabled/> has been received and the SM session is active. */
    get enabled() {
        return this._state.enabled;
    }
    /** Whether the current session was established by resumption. */
    get resumed() {
        return this._state.resumed;
    }
    /** The full JID bound when the SM session was enabled. */
    get boundJid() {
        return this._state.boundJid;
    }
    /** Whether a <resume/> has been sent and not yet answered. */
    get resumePending() {
        return this._resumePending;
    }
    /**
     * Set the storage key (from the user's bare JID) and load any persisted
     * resumable state. Call before deciding between resume and fresh bind.
     * @param jid - The user's JID (a full JID is reduced to its bare form).
     */
    initialize(jid) {
        this._storageKey = `strophe-sm:${jid.split('/')[0].toLowerCase()}`;
        const stored = this._storage.load(this._storageKey);
        if (stored) {
            this._state = Object.assign(Object.assign({}, freshState()), stored);
        }
    }
    /**
     * @returns true if persisted state allows attempting <resume/>.
     */
    hasResumableState() {
        return !!(this._state.id && this._state.resumeSupported);
    }
    /**
     * Reset the in-memory engine (e.g. from Connection.reset()).
     * Persisted state is NOT touched — clearing storage is tied to intent
     * (clean close, logout, failed resume), not to connection reuse.
     */
    reset() {
        this._state = freshState();
        this._resumePending = false;
        this._pendingResend = [];
        this.serverSupported = false;
    }
    /** Remove persisted state (clean close, logout, failed resume). */
    clearPersistedState() {
        if (this._storageKey) {
            this._storage.clear(this._storageKey);
        }
    }
    /**
     * Send <enable/> to start a new SM session. Call after resource binding,
     * at the point CONNECTED is emitted. At most one <enable/> is sent per
     * stream — a second attempt SHOULD get the stream killed by the server
     * (XEP-0198 §3).
     * @param boundJid - The full JID that was just bound.
     */
    sendEnable(boundJid) {
        const s = this._state;
        if (s.enableSent) {
            log.warn('StreamManagement.sendEnable called but <enable/> was already sent for this session');
            return;
        }
        s.enableSent = true;
        s.enabled = false;
        s.resumed = false;
        s.id = null;
        s.max = null;
        s.location = null;
        s.resumeSupported = false;
        s.hIn = 0;
        s.hOutAcked = 0;
        s.sinceLastAck = 0;
        s.unacked = [];
        s.boundJid = boundJid;
        const resume = this._options.requestResume ? ' resume="true"' : '';
        const max = this._options.max ? ` max="${this._options.max}"` : '';
        this._sendRaw(`<enable xmlns="${NS.SM}"${resume}${max}/>`);
        this._persist();
    }
    /**
     * Send <resume/> for the persisted previous session. Call instead of
     * binding, once the post-SASL stream features advertise SM support.
     */
    sendResume() {
        const s = this._state;
        if (!this.hasResumableState()) {
            log.warn('StreamManagement.sendResume called without resumable state');
            return;
        }
        this._resumePending = true;
        this._sendRaw(`<resume xmlns="${NS.SM}" h="${s.hIn}" previd="${xmlEscape(s.id)}"/>`);
    }
    /**
     * @returns true once <enable/> has been sent, i.e. outbound stanzas are
     *     being tracked. Lets the caller skip building a {@link StanzaView}
     *     for {@link trackOutbound} when tracking is inactive, without
     *     reaching into the engine's state.
     */
    isTracking() {
        return this._state.enableSent;
    }
    /**
     * Track an outbound top-level element. Called for every element that
     * enters the send queue; non-countable elements are ignored here.
     * Active from the moment <enable/> is sent (not from <enabled/> receipt —
     * XEP-0198 starts the outbound counter at enable-send).
     * @param view
     */
    trackOutbound(view) {
        const s = this._state;
        if (!s.enableSent || !isCountableStanza(view.name)) {
            return;
        }
        s.unacked.push({ name: view.name, stanza: view.serialized, queuedAt: Date.now() });
        s.sinceLastAck += 1;
        const max = this._options.maxUnacked;
        if (max > 0 && s.sinceLastAck % max === 0) {
            this.requestAck();
        }
        this._persist();
    }
    /**
     * Process one inbound top-level element: count it if it is a countable
     * stanza (when the session is enabled), otherwise handle it as an SM
     * nonza (<r>/<a>/<enabled>/<resumed>/<failed>). Unrecognised elements are
     * ignored. Each host dispatches inbound elements to its own handlers
     * independently of this call, so nothing is returned.
     * @param view
     */
    onInbound(view) {
        if (isCountableStanza(view.name)) {
            this.onInboundStanza(view.name);
            return;
        }
        switch (view.name) {
            case 'r':
                if (this._state.enabled)
                    this.sendAck();
                break;
            case 'a':
                this._handleAck(view);
                break;
            case 'enabled':
                this._handleEnabled(view);
                break;
            case 'resumed':
                this._handleResumed(view);
                break;
            case 'failed':
                this._handleFailed(view);
                break;
        }
    }
    /** Send an unrequested ack request <r/> to the server. */
    requestAck() {
        this._sendRaw(`<r xmlns="${NS.SM}"/>`);
    }
    /**
     * Send an ack <a/> with the current inbound count. Used to answer <r/>,
     * and RECOMMENDED right before gracefully closing the stream (XEP-0198 §4)
     * so the server doesn't redeliver stanzas that were actually received.
     */
    sendAck() {
        this._sendRaw(`<a xmlns="${NS.SM}" h="${this._state.hIn}"/>`);
    }
    /**
     * Count an inbound top-level stanza by name. Adapters call this from
     * their dispatch loop for every inbound child element — non-countable
     * names and inactive sessions are no-ops, so no StanzaView needs to be
     * built for the common case.
     * @param name - The element's local tag name.
     */
    onInboundStanza(name) {
        if (this._state.enabled && isCountableStanza(name)) {
            this._state.hIn = (this._state.hIn + 1) % H_WRAP;
            this._persist();
        }
    }
    /**
     * Call when the stream is about to be closed cleanly: sends a final
     * <a/> so the server doesn't redeliver stanzas that were actually
     * received (RECOMMENDED, XEP-0198 §4), clears persisted state (a
     * cleanly closed stream is not resumable, XEP-0198 §Stream Closure) and
     * deactivates the engine, so nothing sent during teardown is tracked or
     * re-persisted.
     */
    onGracefulClose() {
        if (this._state.enabled) {
            this.sendAck();
        }
        this.clearPersistedState();
        this._state = freshState();
        this._resumePending = false;
        this._pendingResend = [];
    }
    /** Overridable event hook: an SM session was established via <enabled/>. */
    onEnabled() {
        return;
    }
    /** Overridable event hook: the previous session was resumed via <resumed/>. */
    onResumed() {
        return;
    }
    /**
     * Overridable event hook: <enable/> or <resume/> failed.
     * @param _view - The <failed/> nonza (inspect e.g. for <item-not-found/>).
     * @param _resumeFailed - true when the failure answered a <resume/> (the
     *     unacked queue was salvaged for re-send on the next session), false
     *     when it answered an <enable/>.
     */
    onFailed(_view, _resumeFailed) {
        return;
    }
    /**
     * Reconcile the server-reported 'h' against the unacked queue (mod 2^32).
     * An 'h' above our send count is logged and clamped rather than answered
     * with the spec's <handled-count-too-high/> stream close — a client
     * killing the stream over a server bug only hurts the user.
     * @param h
     */
    _reconcile(h) {
        const s = this._state;
        let delta = (h - s.hOutAcked + H_WRAP) % H_WRAP;
        if (delta > s.unacked.length) {
            log.error(`StreamManagement: server acked ${delta} stanzas but only ` +
                `${s.unacked.length} are unacknowledged (h=${h}, previous h=${s.hOutAcked})`);
            delta = s.unacked.length;
        }
        s.unacked = s.unacked.slice(delta);
        s.hOutAcked = h;
    }
    /**
     * @param view
     */
    _handleAck(view) {
        const s = this._state;
        if (!s.enableSent && !s.enabled) {
            return;
        }
        const h = parseH(view.attrs.h);
        if (h === null) {
            log.error('StreamManagement: received <a/> without a valid h attribute');
            return;
        }
        this._reconcile(h);
        s.sinceLastAck = 0;
        this._persist();
    }
    /**
     * @param view
     */
    _handleEnabled(view) {
        const s = this._state;
        if (!s.enableSent) {
            log.warn('StreamManagement: received <enabled/> but <enable/> was not sent; ignoring');
            return;
        }
        s.enabled = true;
        s.id = view.attrs.id || null;
        const max = parseInt(view.attrs.max, 10);
        s.max = Number.isNaN(max) ? null : max;
        s.location = view.attrs.location || null;
        s.resumeSupported = ['true', '1'].includes(view.attrs.resume);
        this._resendPending();
        this._persist();
        this.onEnabled();
    }
    /**
     * @param view
     */
    _handleResumed(view) {
        const s = this._state;
        if (!s.id) {
            log.warn('StreamManagement: received <resumed/> without resumable state; ignoring');
            return;
        }
        this._resumePending = false;
        s.resumed = true;
        s.enabled = true;
        s.enableSent = true;
        const h = parseH(view.attrs.h);
        if (h !== null) {
            this._reconcile(h);
        }
        s.sinceLastAck = 0;
        // Re-send whatever the server didn't acknowledge (a MUST, XEP-0198
        // §5).The root `from` is stripped for symmetry with the failed-resume path;
        // on a resume the resource is unchanged, so this is a no-op for a valid
        // `from`. No delay stamp here since these go out on the same live session.
        for (const entry of s.unacked) {
            this._sendRaw(stripFrom(entry.stanza));
        }
        if (s.unacked.length) {
            this.requestAck();
        }
        this._persist();
        this.onResumed();
    }
    /**
     * <enable/> or <resume/> failed. Trim the queue by the optional 'h' on
     * <failed/>, reset the dead session and clear its persisted state.
     *
     * Only a failed *resumption* strands sent-but-undelivered stanzas, so
     * only then is the remaining queue salvaged for re-send once a fresh
     * session reaches <enabled/> (a SHOULD, XEP-0198 §4). When <failed/>
     * answers an <enable/> the stream is alive and bound — everything in
     * `unacked` was delivered normally; re-sending it later would duplicate
     * it.
     * @param view
     */
    _handleFailed(view) {
        const s = this._state;
        if (!s.enableSent && !s.id) {
            return;
        }
        const resumeFailed = this._resumePending;
        this._resumePending = false;
        const h = parseH(view.attrs.h);
        if (h !== null) {
            this._reconcile(h);
        }
        if (resumeFailed) {
            this._pendingResend = this._pendingResend.concat(s.unacked);
        }
        this._state = freshState();
        this.clearPersistedState();
        this.onFailed(view, resumeFailed);
    }
    /**
     * Re-send stanzas salvaged from a failed resumption on the freshly
     * enabled session. Messages are stamped with a XEP-0203 <delay/> carrying
     * their original send time. The re-sent stanzas enter the new session's
     * unacked queue in wire order.
     */
    _resendPending() {
        const pending = this._pendingResend;
        if (!pending.length) {
            return;
        }
        this._pendingResend = [];
        const s = this._state;
        for (const entry of pending) {
            // Strip the root `from` first: the salvaged strings still carry the
            // dead session's resource, which the freshly bound session would
            // reject as invalid-from. Then apply the message delay stamp.
            const stripped = stripFrom(entry.stanza);
            const stanza = entry.name === 'message' ? stampDelay(stripped, entry.name, entry.queuedAt) : stripped;
            this._sendRaw(stanza);
            s.unacked.push(Object.assign(Object.assign({}, entry), { stanza }));
            s.sinceLastAck += 1;
        }
        this.requestAck();
    }
    /** Persist the current state, if a storage key has been configured. */
    _persist() {
        if (this._storageKey) {
            this._storage.save(this._storageKey, this._state);
        }
    }
}

/**
 * XEP-0198 Stream Management
 *
 * The page-side state mirror for worker mode.
 *
 * Page-only: never imported by the shared-connection-worker bundle.
 */
/**
 * A page-side stand-in for the worker-resident engine: when the connection
 * runs through a SharedWorker, the worker owns all counting, queueing and
 * nonza handling, and the page only mirrors the session state so that
 * `Connection.hasResumed()` and friends keep working.
 */
class StreamManagementMirror {
    constructor() {
        this.serverSupported = false;
        this._state = freshState();
    }
    /* Read surface. Reflects the worker-owned session state. */
    get state() {
        return this._state;
    }
    get enabled() {
        return this._state.enabled;
    }
    get resumed() {
        return this._state.resumed;
    }
    get boundJid() {
        return this._state.boundJid;
    }
    get resumePending() {
        // The worker owns resumption; the page never has a <resume/> in flight.
        return false;
    }
    /* Inert active surface. The worker owns all counting/queueing/nonzas. */
    initialize(_jid) {
        return;
    }
    hasResumableState() {
        return false;
    }
    reset() {
        this._state = freshState();
        this.serverSupported = false;
    }
    sendResume() {
        return;
    }
    sendEnable(_boundJid) {
        return;
    }
    isTracking() {
        return false;
    }
    trackOutbound(_view) {
        return;
    }
    onInbound(_view) {
        return;
    }
    onInboundStanza(_name) {
        return;
    }
    onGracefulClose() {
        return;
    }
    /* Overridable event hooks (a shim overrides these to re-emit on its bus). */
    onEnabled() {
        return;
    }
    onResumed() {
        return;
    }
    onFailed(_view, _resumeFailed) {
        return;
    }
    /* Mirror updates, driven by the worker's lifecycle messages. */
    /**
     * @param id - The SM-ID of the fresh session.
     * @param max - The server's preferred maximum resumption time.
     * @param boundJid - The JID that was bound when the session was enabled.
     */
    _onEnabled(id, max, boundJid) {
        const s = this._state;
        s.enabled = true;
        s.id = id;
        s.max = max;
        s.boundJid = boundJid;
        this.onEnabled();
    }
    /**
     * @param boundJid - The worker's boundJid for the resumed session.
     * @param id - The SM-ID of the resumed session.
     * @param max - The server's preferred maximum resumption time.
     */
    _onResumed(boundJid, id, max) {
        const s = this._state;
        s.resumed = true;
        s.enabled = true;
        s.boundJid = boundJid;
        // Repopulate id/max too: the tab that drove the reconnect reset its
        // mirror when the reconnect started, and _onResumed is the only SM
        // message it receives.
        if (id !== undefined)
            s.id = id;
        if (max !== undefined)
            s.max = max;
        this.onResumed();
    }
    _onFailed() {
        this._state = freshState();
        // _smFailed is only broadcast for a failed *resumption* (a refused
        // <enable/> stays inside the worker), so resumeFailed is always true.
        this.onFailed(undefined, true);
    }
}

/**
 * Build the environment-free {@link StanzaView} consumed by the XEP-0198
 * engine from a DOM Element.
 * @param el
 */
function toStanzaView(el) {
    const attrs = {};
    for (let i = 0; i < el.attributes.length; i++) {
        const attr = el.attributes[i];
        attrs[attr.name] = attr.value;
    }
    return { name: el.tagName, attrs, serialized: new XMLSerializer().serializeToString(el) };
}

/**
 * _Private_ variable Used to store plugin names that need
 * initialization during Connection construction.
 */
const connectionPlugins = {};
/**
 * _Private_ registry of optional, environment-specific transports keyed by the
 * `protocol` option that selects them. The Node-only XEP-0114 component
 * transport registers itself here (see the Node entry point) so that its
 * Node-only dependencies never reach the browser bundle.
 */
const transportProtocols = {};
/**
 * **XMPP Connection manager**
 *
 * This class is the main part of Strophe.  It manages a BOSH or websocket
 * connection to an XMPP server and dispatches events to the user callbacks
 * as data arrives.
 *
 * It supports various authentication mechanisms (e.g. SASL PLAIN, SASL SCRAM),
 * and more can be added via
 * {@link Connection#registerSASLMechanisms|registerSASLMechanisms()}.
 *
 * After creating a Connection object, the user will typically
 * call {@link Connection#connect|connect()} with a user supplied callback
 * to handle connection level events like authentication failure,
 * disconnection, or connection complete.
 *
 * The user will also have several event handlers defined by using
 * {@link Connection#addHandler|addHandler()} and
 * {@link Connection#addTimedHandler|addTimedHandler()}.
 * These will allow the user code to respond to interesting stanzas or do
 * something periodically with the connection. These handlers will be active
 * once authentication is finished.
 *
 * To send data to the connection, use {@link Connection#send|send()}.
 *
 * @memberof Strophe
 */
class Connection {
    /**
     * Create and initialize a {@link Connection} object.
     *
     * The transport-protocol for this connection will be chosen automatically
     * based on the given service parameter. URLs starting with "ws://" or
     * "wss://" will use WebSockets, URLs starting with "http://", "https://"
     * or without a protocol will use [BOSH](https://xmpp.org/extensions/xep-0124.html).
     *
     * To make Strophe connect to the current host you can leave out the protocol
     * and host part and just pass the path:
     *
     *  const conn = new Strophe.Connection("/http-bind/");
     *
     * @param service - The BOSH or WebSocket service URL.
     * @param options - A object containing configuration options
     */
    constructor(service, options = {}) {
        // The service URL
        this.service = service;
        // Configuration options
        this.options = options;
        this.setProtocol();
        this._smHandlers = [];
        if (options.enableStreamManagement) {
            if (options.worker) {
                // Under a shared worker the page hosts no SM engine since
                // the worker owns all counting and queueing. The mirror
                // only reflects the session state so that hasResumed()
                // and friends keep working in every tab.
                this.sm = new StreamManagementMirror();
            }
            else {
                // The engine is constructed regardless of the current
                // transport since embedders may swap `_proto` after construction.
                const smOptions = Object.assign({}, (options.streamManagement || {}));
                if (!smOptions.storage && typeof sessionStorage !== 'undefined') {
                    smOptions.storage = new SessionStorageBackend();
                }
                // The SM engine emits nonzas (and re-sends queued stanzas) as
                // strings. They are pushed directly onto the send queue and
                // they ride the same FIFO, so an <r/> goes out after the
                // stanzas it covers.
                this.sm = new StreamManagement((data) => {
                    this._data.push(toElement(data));
                    this._proto._send();
                }, smOptions);
            }
        }
        /* The connected JID. */
        this.jid = '';
        /* the JIDs domain */
        this.domain = null;
        /* stream:features */
        this.features = null;
        // SASL
        this._sasl_data = {};
        this.do_bind = false;
        this.do_session = false;
        this.mechanisms = {};
        this.timedHandlers = [];
        this.handlers = [];
        this.removeTimeds = [];
        this.removeHandlers = [];
        this.addTimeds = [];
        this.addHandlers = [];
        this.protocolErrorHandlers = {
            'HTTP': {},
            'websocket': {},
        };
        this._idleTimeout = null;
        this._disconnectTimeout = null;
        this.authenticated = false;
        this.connected = false;
        this.disconnecting = false;
        this.do_authentication = true;
        this.paused = false;
        this.restored = false;
        this._data = [];
        this._uniqueId = 0;
        this._sasl_success_handler = null;
        this._sasl_failure_handler = null;
        this._sasl_challenge_handler = null;
        // Max retries before disconnecting
        this.maxRetries = 5;
        // Call onIdle callback every 1/10th of a second
        this._scheduleIdle();
        addCookies(this.options.cookies);
        this.registerSASLMechanisms(this.options.mechanisms);
        // A client must always respond to incoming IQ "set" and "get" stanzas.
        // See https://datatracker.ietf.org/doc/html/rfc6120#section-8.2.3
        //
        // This is a fallback handler which gets called when no other handler
        // was called for a received IQ "set" or "get".
        this.iqFallbackHandler = new Handler((iq) => {
            this.send($iq({ type: 'error', id: iq.getAttribute('id') })
                .c('error', { 'type': 'cancel' })
                .c('service-unavailable', { 'xmlns': NS.STANZAS }));
            return false;
        }, null, null, ['get', 'set'], null, null);
        // initialize plugins
        for (const k in connectionPlugins) {
            if (Object.prototype.hasOwnProperty.call(connectionPlugins, k)) {
                const F = function () { };
                F.prototype = connectionPlugins[k];
                // @ts-ignore
                this[k] = new F();
                // @ts-ignore
                this[k].init(this);
            }
        }
    }
    /**
     * Extends the Connection object with the given plugin.
     * @param name - The name of the extension.
     * @param ptype - The plugin's prototype.
     */
    static addConnectionPlugin(name, ptype) {
        connectionPlugins[name] = ptype;
    }
    /**
     * Register an optional transport, selectable via the `protocol` connection
     * option. Used to plug in environment-specific transports (such as the
     * Node-only XEP-0114 component transport) without the core browser build
     * depending on them.
     * @param name - The `protocol` option value that selects this transport.
     * @param manager - The transport (protocol-manager) constructor.
     */
    static addProtocol(name, manager) {
        transportProtocols[name] = manager;
    }
    /**
     * Select protocal based on this.options or this.service
     */
    setProtocol() {
        const proto = this.options.protocol || '';
        const RegisteredTransport = transportProtocols[proto];
        if (RegisteredTransport) {
            this._proto = new RegisteredTransport(this);
        }
        else if (this.options.worker) {
            this._proto = new WorkerWebsocket(this);
        }
        else if (this.service.indexOf('ws:') === 0 ||
            this.service.indexOf('wss:') === 0 ||
            proto.indexOf('ws') === 0) {
            this._proto = new Websocket(this);
        }
        else if (proto) {
            throw new Error(`Strophe: unknown connection protocol "${proto}". Valid values are "ws" and "wss"; ` +
                `other transports must first be registered with Connection.addProtocol().`);
        }
        else {
            this._proto = new Bosh(this);
        }
    }
    /**
     * Reset the connection.
     *
     * This function should be called after a connection is disconnected
     * before that connection is reused.
     */
    reset() {
        var _a;
        this._proto._reset();
        // In-memory SM state only. Persisted (resumable) state is kept and
        // reloaded when the next stream advertises SM support.
        (_a = this.sm) === null || _a === void 0 ? void 0 : _a.reset();
        // SASL
        this.do_session = false;
        this.do_bind = false;
        // handler lists
        this.timedHandlers = [];
        this.handlers = [];
        this.removeTimeds = [];
        this.removeHandlers = [];
        this.addTimeds = [];
        this.addHandlers = [];
        this.authenticated = false;
        this.connected = false;
        this.disconnecting = false;
        this.restored = false;
        this._data = [];
        this._requests = [];
        this._uniqueId = 0;
    }
    /**
     * @returns true if the current session was established by resuming a
     *     previous one via XEP-0198 Stream Management (in which case the
     *     previously bound resource is still valid and roster/presence
     *     state was retained by the server).
     */
    hasResumed() {
        var _a;
        return !!((_a = this.sm) === null || _a === void 0 ? void 0 : _a.resumed);
    }
    /**
     * @returns true if a XEP-0198 Stream Management session is currently
     *     active (i.e. <enabled/> was received or a session was resumed).
     */
    isStreamManagementEnabled() {
        var _a;
        return !!((_a = this.sm) === null || _a === void 0 ? void 0 : _a.enabled);
    }
    /**
     * Pause the request manager.
     *
     * This will prevent Strophe from sending any more requests to the
     * server.  This is very useful for temporarily pausing
     * BOSH-Connections while a lot of send() calls are happening quickly.
     * This causes Strophe to send the data in a single request, saving
     * many request trips.
     */
    pause() {
        this.paused = true;
    }
    /**
     * Resume the request manager.
     *
     * This resumes after pause() has been called.
     */
    resume() {
        this.paused = false;
    }
    /**
     * Generate a unique ID for use in <iq/> elements.
     *
     * All <iq/> stanzas are required to have unique id attributes.  This
     * function makes creating these easy.  Each connection instance has
     * a counter which starts from zero, and the value of this counter
     * plus a colon followed by the suffix becomes the unique id. If no
     * suffix is supplied, the counter is used as the unique id.
     *
     * Suffixes are used to make debugging easier when reading the stream
     * data, and their use is recommended.  The counter resets to 0 for
     * every new connection for the same reason.  For connections to the
     * same server that authenticate the same way, all the ids should be
     * the same, which makes it easy to see changes.  This is useful for
     * automated testing as well.
     *
     * @param suffix - A optional suffix to append to the id.
     * @returns A unique string to be used for the id attribute.
     */
    getUniqueId(suffix) {
        const uuid = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
            const r = (Math.random() * 16) | 0, v = c === 'x' ? r : (r & 0x3) | 0x8;
            return v.toString(16);
        });
        if (typeof suffix === 'string' || typeof suffix === 'number') {
            return uuid + ':' + suffix;
        }
        else {
            return uuid + '';
        }
    }
    /**
     * Register a handler function for when a protocol (websocker or HTTP)
     * error occurs.
     *
     * NOTE: Currently only HTTP errors for BOSH requests are handled.
     * Patches that handle websocket errors would be very welcome.
     *
     * @example
     *  function onError(err_code){
     *    //do stuff
     *  }
     *
     *  const conn = Strophe.connect('http://example.com/http-bind');
     *  conn.addProtocolErrorHandler('HTTP', 500, onError);
     *  // Triggers HTTP 500 error and onError handler will be called
     *  conn.connect('user_jid@incorrect_jabber_host', 'secret', onConnect);
     *
     * @param protocol - 'HTTP' or 'websocket'
     * @param status_code - Error status code (e.g 500, 400 or 404)
     * @param callback - Function that will fire on Http error
     */
    addProtocolErrorHandler(protocol, status_code, callback) {
        this.protocolErrorHandlers[protocol][status_code] = callback;
    }
    /**
     * Starts the connection process.
     *
     * As the connection process proceeds, the user supplied callback will
     * be triggered multiple times with status updates.  The callback
     * should take two arguments - the status code and the error condition.
     *
     * The status code will be one of the values in the Strophe.Status
     * constants.  The error condition will be one of the conditions
     * defined in RFC 3920 or the condition 'strophe-parsererror'.
     *
     * The Parameters _wait_, _hold_ and _route_ are optional and only relevant
     * for BOSH connections. Please see XEP 124 for a more detailed explanation
     * of the optional parameters.
     *
     * @param jid - The user's JID.  This may be a bare JID,
     *     or a full JID.  If a node is not supplied, SASL OAUTHBEARER or
     *     SASL ANONYMOUS authentication will be attempted (OAUTHBEARER will
     *     process the provided password value as an access token).
     *   (String or Object) pass - The user's password, or an object containing
     *     the users SCRAM client and server keys, in a fashion described as follows:
     *
     *     { name: String, representing the hash used (eg. SHA-1),
     *       salt: String, base64 encoded salt used to derive the client key,
     *       iter: Int,    the iteration count used to derive the client key,
     *       ck:   String, the base64 encoding of the SCRAM client key
     *       sk:   String, the base64 encoding of the SCRAM server key
     *     }
     * @param pass - The user password
     * @param callback - The connect callback function.
     * @param wait - The optional HTTPBIND wait value.  This is the
     *     time the server will wait before returning an empty result for
     *     a request.  The default setting of 60 seconds is recommended.
     * @param hold - The optional HTTPBIND hold value.  This is the
     *     number of connections the server will hold at one time.  This
     *     should almost always be set to 1 (the default).
     * @param route - The optional route value.
     * @param authcid - The optional alternative authentication identity
     *     (username) if intending to impersonate another user.
     *     When using the SASL-EXTERNAL authentication mechanism, for example
     *     with client certificates, then the authcid value is used to
     *     determine whether an authorization JID (authzid) should be sent to
     *     the server. The authzid should NOT be sent to the server if the
     *     authzid and authcid are the same. So to prevent it from being sent
     *     (for example when the JID is already contained in the client
     *     certificate), set authcid to that same JID. See XEP-178 for more
     *     details.
     *  @param disconnection_timeout - The optional disconnection timeout
     *     in milliseconds before _doDisconnect will be called.
     */
    connect(jid, pass, callback, wait, hold, route, authcid, disconnection_timeout = 3000) {
        var _a;
        this.jid = jid;
        /** Authorization identity */
        this.authzid = getBareJidFromJid(this.jid);
        /** Authentication identity (User name) */
        this.authcid = authcid || getNodeFromJid(this.jid);
        /** Authentication identity (User password) */
        this.pass = pass;
        /**
         * The SASL SCRAM client and server keys. This variable will be populated with a non-null
         * object of the above described form after a successful SCRAM connection
         */
        this.scram_keys = null;
        this.connect_callback = callback;
        this.disconnecting = false;
        this.connected = false;
        this.authenticated = false;
        this.restored = false;
        this.disconnection_timeout = disconnection_timeout;
        // Per-stream SM state starts fresh; resumable state is reloaded from
        // storage once the server advertises SM (_onStreamFeaturesAfterSASL).
        (_a = this.sm) === null || _a === void 0 ? void 0 : _a.reset();
        // parse jid for domain
        this.domain = getDomainFromJid(this.jid);
        this._changeConnectStatus(Status.CONNECTING, null);
        this._proto._connect(wait, hold, route);
    }
    /**
     * Attach to an already created and authenticated BOSH session.
     *
     * This function is provided to allow Strophe to attach to BOSH
     * sessions which have been created externally, perhaps by a Web
     * application.  This is often used to support auto-login type features
     * without putting user credentials into the page.
     *
     * @param jid - The full JID that is bound by the session.
     * @param sid - The SID of the BOSH session.
     * @param rid - The current RID of the BOSH session.  This RID
     *     will be used by the next request.
     * @param callback - The connect callback function.
     * @param wait - The optional HTTPBIND wait value.  This is the
     *     time the server will wait before returning an empty result for
     *     a request.  The default setting of 60 seconds is recommended.
     *     Other settings will require tweaks to the Strophe.TIMEOUT value.
     * @param hold - The optional HTTPBIND hold value.  This is the
     *     number of connections the server will hold at one time.  This
     *     should almost always be set to 1 (the default).
     * @param wind - The optional HTTBIND window value.  This is the
     *     allowed range of request ids that are valid.  The default is 5.
     */
    attach(jid, sid, rid, callback, wait, hold, wind) {
        if (this._proto instanceof Bosh && typeof jid === 'string') {
            return this._proto._attach(jid, sid, rid, callback, wait, hold, wind);
        }
        else if (this._proto instanceof WorkerWebsocket && typeof jid === 'function') {
            return this._proto._attach(jid);
        }
        else {
            throw new SessionError('The "attach" method is not available for your connection protocol');
        }
    }
    /**
     * Attempt to restore a cached BOSH session.
     *
     * This function is only useful in conjunction with providing the
     * "keepalive":true option when instantiating a new {@link Connection}.
     *
     * When "keepalive" is set to true, Strophe will cache the BOSH tokens
     * RID (Request ID) and SID (Session ID) and then when this function is
     * called, it will attempt to restore the session from those cached
     * tokens.
     *
     * This function must therefore be called instead of connect or attach.
     *
     * For an example on how to use it, please see examples/restore.js
     *
     * @param jid - The user's JID.  This may be a bare JID or a full JID.
     * @param callback - The connect callback function.
     * @param wait - The optional HTTPBIND wait value.  This is the
     *     time the server will wait before returning an empty result for
     *     a request.  The default setting of 60 seconds is recommended.
     * @param hold - The optional HTTPBIND hold value.  This is the
     *     number of connections the server will hold at one time.  This
     *     should almost always be set to 1 (the default).
     * @param wind - The optional HTTBIND window value.  This is the
     *     allowed range of request ids that are valid.  The default is 5.
     */
    restore(jid, callback, wait, hold, wind) {
        if (!(this._proto instanceof Bosh) || !this._sessionCachingSupported()) {
            throw new SessionError('The "restore" method can only be used with a BOSH connection.');
        }
        if (this._sessionCachingSupported()) {
            this._proto._restore(jid, callback, wait, hold, wind);
        }
    }
    /**
     * Checks whether sessionStorage and JSON are supported and whether we're
     * using BOSH.
     */
    _sessionCachingSupported() {
        if (this._proto instanceof Bosh) {
            if (!JSON) {
                return false;
            }
            try {
                sessionStorage.setItem('_strophe_', '_strophe_');
                sessionStorage.removeItem('_strophe_');
            }
            catch (_e) {
                return false;
            }
            return true;
        }
        return false;
    }
    /**
     * User overrideable function that receives XML data coming into the
     * connection.
     *
     * Due to limitations of current Browsers' XML-Parsers the opening and closing
     * <stream> tag for WebSocket-Connoctions will be passed as selfclosing here.
     *
     * BOSH-Connections will have all stanzas wrapped in a <body> tag. See
     * <Bosh.strip> if you want to strip this tag.
     *
     * @param _elem - The XML data received by the connection.
     */
    xmlInput(_elem) {
        return;
    }
    /**
     * User overrideable function that receives XML data sent to the
     * connection.
     *
     * Due to limitations of current Browsers' XML-Parsers the opening and closing
     * <stream> tag for WebSocket-Connoctions will be passed as selfclosing here.
     *
     * BOSH-Connections will have all stanzas wrapped in a <body> tag. See
     * <Bosh.strip> if you want to strip this tag.
     *
     * @param _elem - The XMLdata sent by the connection.
     */
    xmlOutput(_elem) {
        return;
    }
    /**
     * User overrideable function that receives raw data coming into the
     * connection.
     *
     * @param _data - The data received by the connection.
     */
    rawInput(_data) {
        return;
    }
    /**
     * User overrideable function that receives raw data sent to the
     * connection.
     *
     * @param _data - The data sent by the connection.
     */
    rawOutput(_data) {
        return;
    }
    /**
     * User overrideable function that receives the new valid rid.
     *
     * @param _rid - The next valid rid
     */
    nextValidRid(_rid) {
        return;
    }
    /**
     * User overrideable function that receives the new role of this
     * connection in a shared-worker setup.
     *
     * Called when the shared worker assigns or changes this tab's role,
     * for example when this tab is promoted to 'primary' after the previous
     * primary tab went away.
     *
     * @param _role - The new role ('primary' or 'secondary')
     */
    onRoleChanged(_role) {
        return;
    }
    /**
     * User overrideable function that receives message and presence stanzas
     * sent by *another* tab sharing this connection (via the `worker`
     * option), so every tab can render what any tab sent.
     *
     * Deliberately separate from the inbound handler pipeline: these stanzas
     * were sent, not received, so they must not trigger stanza handlers.
     * IQs are not reflected — they are request/response traffic private to
     * the sending tab.
     *
     * @param _elem - The sent stanza.
     */
    onForeignStanzaSent(_elem) {
        return;
    }
    /**
     * Send a stanza.
     *
     * This function is called to push data onto the send queue to
     * go out over the wire.  Whenever a request is sent to the BOSH
     * server, all pending data is sent and the queue is flushed.
     *
     * @param stanza - The stanza to send
     */
    send(stanza) {
        if (stanza === null)
            return;
        if (Array.isArray(stanza)) {
            stanza.forEach((s) => this._queueData(s instanceof Builder ? s.tree() : s));
        }
        else {
            const el = stanza instanceof Builder ? stanza.tree() : stanza;
            this._queueData(el);
        }
        this._proto._send();
    }
    /**
     * Immediately send any pending outgoing data.
     *
     * Normally send() queues outgoing data until the next idle period
     * (100ms), which optimizes network use in the common cases when
     * several send()s are called in succession. flush() can be used to
     * immediately send all pending data.
     */
    flush() {
        // cancel the pending idle period and run the idle function
        // immediately
        clearTimeout(this._idleTimeout);
        this._onIdle();
    }
    /**
     * Helper function to send presence stanzas. The main benefit is for
     * sending presence stanzas for which you expect a responding presence
     * stanza with the same id (for example when leaving a chat room).
     *
     * @param stanza - The stanza to send.
     * @param callback - The callback function for a successful request.
     * @param errback - The callback function for a failed or timed
     *    out request.  On timeout, the stanza will be null.
     * @param timeout - The time specified in milliseconds for a
     *    timeout to occur.
     * @return The id used to send the presence.
     */
    sendPresence(stanza, callback, errback, timeout) {
        let timeoutHandler = null;
        const el = stanza instanceof Builder ? stanza.tree() : stanza;
        let id = el.getAttribute('id');
        if (!id) {
            // inject id if not found
            id = this.getUniqueId('sendPresence');
            el.setAttribute('id', id);
        }
        if (typeof callback === 'function' || typeof errback === 'function') {
            const handler = this.addHandler((stanza) => {
                // remove timeout handler if there is one
                if (timeoutHandler)
                    this.deleteTimedHandler(timeoutHandler);
                if (stanza.getAttribute('type') === 'error') {
                    errback === null || errback === void 0 ? void 0 : errback(stanza);
                }
                else if (callback) {
                    callback(stanza);
                }
                return false;
            }, null, 'presence', null, id);
            // if timeout specified, set up a timeout handler.
            if (timeout) {
                timeoutHandler = this.addTimedHandler(timeout, () => {
                    // get rid of normal handler
                    this.deleteHandler(handler);
                    // call errback on timeout with null stanza
                    errback === null || errback === void 0 ? void 0 : errback(null);
                    return false;
                });
            }
        }
        this.send(el);
        return id;
    }
    /**
     * Helper function to send IQ stanzas.
     *
     * @param stanza - The stanza to send.
     * @param callback - The callback function for a successful request.
     * @param errback - The callback function for a failed or timed
     *     out request.  On timeout, the stanza will be null.
     * @param timeout - The time specified in milliseconds for a
     *     timeout to occur.
     * @return The id used to send the IQ.
     */
    sendIQ(stanza, callback, errback, timeout) {
        let timeoutHandler = null;
        const el = stanza instanceof Builder ? stanza.tree() : stanza;
        let id = el.getAttribute('id');
        if (!id) {
            // inject id if not found
            id = this.getUniqueId('sendIQ');
            el.setAttribute('id', id);
        }
        if (typeof callback === 'function' || typeof errback === 'function') {
            const handler = this.addHandler((stanza) => {
                // remove timeout handler if there is one
                if (timeoutHandler)
                    this.deleteTimedHandler(timeoutHandler);
                const iqtype = stanza.getAttribute('type');
                if (iqtype === 'result') {
                    callback === null || callback === void 0 ? void 0 : callback(stanza);
                }
                else if (iqtype === 'error') {
                    errback === null || errback === void 0 ? void 0 : errback(stanza);
                }
                else {
                    const error = new Error(`Got bad IQ type of ${iqtype}`);
                    error.name = 'StropheError';
                    throw error;
                }
                return false;
            }, null, 'iq', ['error', 'result'], id);
            // if timeout specified, set up a timeout handler.
            if (timeout) {
                timeoutHandler = this.addTimedHandler(timeout, () => {
                    // get rid of normal handler
                    this.deleteHandler(handler);
                    // call errback on timeout with null stanza
                    errback === null || errback === void 0 ? void 0 : errback(null);
                    return false;
                });
            }
        }
        this.send(el);
        return id;
    }
    /**
     * Queue outgoing data for later sending.  Also ensures that the data
     * is a DOMElement.
     * @private
     * @param element
     */
    _queueData(element) {
        var _a;
        if (element === null || !element.tagName || !element.childNodes) {
            const error = new Error('Cannot queue non-DOMElement.');
            error.name = 'StropheError';
            throw error;
        }
        this._data.push(element);
        // XEP-0198: every countable outbound stanza is queued here, after the
        // push, so that an <r/> emitted by the engine lands behind it in the
        // send FIFO. Hooking _queueData (rather than send/sendIQ/sendPresence)
        // means raw send() calls can't escape the counting.
        if (((_a = this.sm) === null || _a === void 0 ? void 0 : _a.isTracking()) && isCountableStanza(element.tagName)) {
            this.sm.trackOutbound(toStanzaView(element));
        }
    }
    /**
     * Send an xmpp:restart stanza.
     * @private
     */
    _sendRestart() {
        this._data.push('restart');
        this._proto._sendRestart();
        this._scheduleIdle();
    }
    /**
     * Add a timed handler to the connection.
     *
     * This function adds a timed handler.  The provided handler will
     * be called every period milliseconds until it returns false,
     * the connection is terminated, or the handler is removed.  Handlers
     * that wish to continue being invoked should return true.
     *
     * Because of method binding it is necessary to save the result of
     * this function if you wish to remove a handler with
     * deleteTimedHandler().
     *
     * Note that user handlers are not active until authentication is
     * successful.
     *
     * @param period - The period of the handler.
     * @param handler - The callback function.
     * @return A reference to the handler that can be used to remove it.
     */
    addTimedHandler(period, handler) {
        const thand = new TimedHandler(period, handler);
        this.addTimeds.push(thand);
        return thand;
    }
    /**
     * Delete a timed handler for a connection.
     *
     * This function removes a timed handler from the connection.  The
     * handRef parameter is *not* the function passed to addTimedHandler(),
     * but is the reference returned from addTimedHandler().
     * @param handRef - The handler reference.
     */
    deleteTimedHandler(handRef) {
        // this must be done in the Idle loop so that we don't change
        // the handlers during iteration
        this.removeTimeds.push(handRef);
    }
    /**
     * Add a stanza handler for the connection.
     *
     * This function adds a stanza handler to the connection.  The
     * handler callback will be called for any stanza that matches
     * the parameters.  Note that if multiple parameters are supplied,
     * they must all match for the handler to be invoked.
     *
     * The handler will receive the stanza that triggered it as its argument.
     * *The handler should return true if it is to be invoked again;
     * returning false will remove the handler after it returns.*
     *
     * As a convenience, the ns parameters applies to the top level element
     * and also any of its immediate children.  This is primarily to make
     * matching /iq/query elements easy.
     *
     * ### Options
     *
     * With the options argument, you can specify boolean flags that affect how
     * matches are being done.
     *
     * Currently two flags exist:
     *
     * * *matchBareFromJid*:
     *     When set to true, the from parameter and the
     *     from attribute on the stanza will be matched as bare JIDs instead
     *     of full JIDs. To use this, pass {matchBareFromJid: true} as the
     *     value of options. The default value for matchBareFromJid is false.
     *
     * * *ignoreNamespaceFragment*:
     *     When set to true, a fragment specified on the stanza's namespace
     *     URL will be ignored when it's matched with the one configured for
     *     the handler.
     *
     *     This means that if you register like this:
     *
     *     >   connection.addHandler(
     *     >       handler,
     *     >       'http://jabber.org/protocol/muc',
     *     >       null, null, null, null,
     *     >       {'ignoreNamespaceFragment': true}
     *     >   );
     *
     *     Then a stanza with XML namespace of
     *     'http://jabber.org/protocol/muc#user' will also be matched. If
     *     'ignoreNamespaceFragment' is false, then only stanzas with
     *     'http://jabber.org/protocol/muc' will be matched.
     *
     * ### Deleting the handler
     *
     * The return value should be saved if you wish to remove the handler
     * with `deleteHandler()`.
     *
     * @param handler - The user callback.
     * @param ns - The namespace to match.
     * @param name - The stanza name to match.
     * @param type - The stanza type (or types if an array) to match.
     * @param id - The stanza id attribute to match.
     * @param from - The stanza from attribute to match.
     * @param options - The handler options
     * @return A reference to the handler that can be used to remove it.
     */
    addHandler(handler, ns, name, type, id, from, options) {
        const hand = new Handler(handler, ns, name, type, id, from, options);
        this.addHandlers.push(hand);
        return hand;
    }
    /**
     * Delete a stanza handler for a connection.
     *
     * This function removes a stanza handler from the connection.  The
     * handRef parameter is *not* the function passed to addHandler(),
     * but is the reference returned from addHandler().
     *
     * @param handRef - The handler reference.
     */
    deleteHandler(handRef) {
        // this must be done in the Idle loop so that we don't change
        // the handlers during iteration
        this.removeHandlers.push(handRef);
        // If a handler is being deleted while it is being added,
        // prevent it from getting added
        const i = this.addHandlers.indexOf(handRef);
        if (i >= 0) {
            this.addHandlers.splice(i, 1);
        }
    }
    /**
     * Register the SASL mechanisms which will be supported by this instance of
     * Connection (i.e. which this XMPP client will support).
     * @param mechanisms - Array of objects with SASLMechanism prototypes
     */
    registerSASLMechanisms(mechanisms) {
        this.mechanisms = {};
        (mechanisms || [
            SASLAnonymous,
            SASLExternal,
            SASLOAuthBearer,
            SASLXOAuth2,
            SASLPlain,
            SASLSHA1,
            SASLSHA256,
            SASLSHA384,
            SASLSHA512,
        ]).forEach((m) => this.registerSASLMechanism(m));
    }
    /**
     * Register a single SASL mechanism, to be supported by this client.
     * @param Mechanism - Object with a Strophe.SASLMechanism prototype
     */
    registerSASLMechanism(Mechanism) {
        const mechanism = new Mechanism();
        this.mechanisms[mechanism.mechname] = mechanism;
    }
    /**
     * Start the graceful disconnection process.
     *
     * This function starts the disconnection process.  This process starts
     * by sending unavailable presence and sending BOSH body of type
     * terminate.  A timeout handler makes sure that disconnection happens
     * even if the BOSH server does not respond.
     * If the Connection object isn't connected, at least tries to abort all pending requests
     * so the connection object won't generate successful requests (which were already opened).
     *
     * The user supplied connection callback will be notified of the
     * progress as this process happens.
     *
     * @param reason - The reason the disconnect is occuring.
     */
    disconnect(reason) {
        var _a;
        this._changeConnectStatus(Status.DISCONNECTING, reason);
        if (reason) {
            log.info('Disconnect was called because: ' + reason);
        }
        else {
            log.debug('Disconnect was called');
        }
        if (this.connected) {
            let pres = null;
            this.disconnecting = true;
            if (this.authenticated) {
                pres = $pres({
                    'xmlns': NS.CLIENT,
                    'type': 'unavailable',
                }).tree();
            }
            // A cleanly closed stream is not resumable: send a final <a/> so
            // the server doesn't redeliver stanzas we already received, and
            // drop the persisted XEP-0198 state.
            (_a = this.sm) === null || _a === void 0 ? void 0 : _a.onGracefulClose();
            // setup timeout handler
            this._disconnectTimeout = this._addSysTimedHandler(this.disconnection_timeout, this._onDisconnectTimeout.bind(this));
            this._proto._disconnect(pres);
        }
        else {
            log.debug('Disconnect was called before Strophe connected to the server');
            this._proto._abortAllRequests();
            this._doDisconnect();
        }
    }
    /**
     * _Private_ helper function that makes sure plugins and the user's
     * callback are notified of connection status changes.
     * @param status - the new connection status, one of the values
     *     in Strophe.Status
     * @param condition - the error condition
     * @param elem - The triggering stanza.
     */
    _changeConnectStatus(status, condition, elem) {
        // notify all plugins listening for status changes
        for (const k in connectionPlugins) {
            if (Object.prototype.hasOwnProperty.call(connectionPlugins, k)) {
                // @ts-ignore
                const plugin = this[k];
                if (plugin.statusChanged) {
                    try {
                        plugin.statusChanged(status, condition);
                    }
                    catch (err) {
                        log.error(`${k} plugin caused an exception changing status: ${err}`);
                    }
                }
            }
        }
        // notify the user's callback
        if (this.connect_callback) {
            try {
                this.connect_callback(status, condition, elem);
            }
            catch (e) {
                handleError(e);
                log.error(`User connection callback caused an exception: ${e}`);
            }
        }
    }
    /**
     * _Private_ function to disconnect.
     *
     * This is the last piece of the disconnection logic.  This resets the
     * connection and alerts the user's connection callback.
     * @param condition - the error condition
     */
    _doDisconnect(condition) {
        clearTimeout(this._idleTimeout);
        // Cancel Disconnect Timeout
        if (this._disconnectTimeout !== null) {
            this.deleteTimedHandler(this._disconnectTimeout);
            this._disconnectTimeout = null;
        }
        log.debug('_doDisconnect was called');
        this._proto._doDisconnect();
        this.authenticated = false;
        this.disconnecting = false;
        this.restored = false;
        // delete handlers
        this.handlers = [];
        this.timedHandlers = [];
        this.removeTimeds = [];
        this.removeHandlers = [];
        this.addTimeds = [];
        this.addHandlers = [];
        // tell the parent we disconnected
        this._changeConnectStatus(Status.DISCONNECTED, condition);
        this.connected = false;
    }
    /**
     * _Private_ handler to processes incoming data from the the connection.
     *
     * Except for _connect_cb handling the initial connection request,
     * this function handles the incoming data for all requests.  This
     * function also fires stanza handlers that match each incoming
     * stanza.
     * @param req - The request that has data ready.
     * @param raw - The stanza as raw string.
     */
    _dataRecv(req, raw) {
        const elem = (this._proto instanceof Bosh ? this._proto._reqToData(req) : req);
        if (elem === null) {
            return;
        }
        if (this.xmlInput !== Connection.prototype.xmlInput) {
            if (elem.nodeName === this._proto.strip && elem.childNodes.length) {
                this.xmlInput(elem.childNodes[0]);
            }
            else {
                this.xmlInput(elem);
            }
        }
        if (this.rawInput !== Connection.prototype.rawInput) {
            if (raw) {
                this.rawInput(raw);
            }
            else {
                this.rawInput(Builder.serialize(elem));
            }
        }
        // remove handlers scheduled for deletion
        while (this.removeHandlers.length > 0) {
            const hand = this.removeHandlers.pop();
            const i = this.handlers.indexOf(hand);
            if (i >= 0) {
                this.handlers.splice(i, 1);
            }
        }
        // add handlers scheduled for addition
        while (this.addHandlers.length > 0) {
            this.handlers.push(this.addHandlers.pop());
        }
        // handle graceful disconnect
        if (this.disconnecting && this._proto._emptyQueue()) {
            this._doDisconnect();
            return;
        }
        const type = elem.getAttribute('type');
        if (type !== null && type === 'terminate') {
            // Don't process stanzas that come in after disconnect
            if (this.disconnecting) {
                return;
            }
            // an error occurred
            let cond = elem.getAttribute('condition');
            const conflict = elem.getElementsByTagName('conflict');
            if (cond !== null) {
                if (cond === 'remote-stream-error' && conflict.length > 0) {
                    cond = 'conflict';
                }
                this._changeConnectStatus(Status.CONNFAIL, cond);
            }
            else {
                this._changeConnectStatus(Status.CONNFAIL, ErrorCondition.UNKNOWN_REASON);
            }
            this._doDisconnect(cond);
            return;
        }
        // send each incoming stanza through the handler chain
        forEachChild(elem, null, (child) => {
            var _a;
            // XEP-0198: count inbound stanzas here in the dispatch loop —
            // exactly-once, in order, and immune to handler churn.
            (_a = this.sm) === null || _a === void 0 ? void 0 : _a.onInboundStanza(child.nodeName);
            const matches = [];
            this.handlers = this.handlers.reduce((handlers, handler) => {
                try {
                    if (handler.isMatch(child) && (this.authenticated || !handler.user)) {
                        if (handler.run(child)) {
                            handlers.push(handler);
                        }
                        matches.push(handler);
                    }
                    else {
                        handlers.push(handler);
                    }
                }
                catch (e) {
                    // if the handler throws an exception, we consider it as false
                    log.warn('Removing Strophe handlers due to uncaught exception: ' + e.message);
                }
                return handlers;
            }, []);
            // If no handler was fired for an incoming IQ with type="set",
            // then we return an IQ error stanza with service-unavailable.
            if (!matches.length && this.iqFallbackHandler.isMatch(child)) {
                this.iqFallbackHandler.run(child);
            }
        });
    }
    /**
     * _Private_ handler for initial connection request.
     *
     * This handler is used to process the initial connection request
     * response from the BOSH server. It is used to set up authentication
     * handlers and start the authentication process.
     *
     * SASL authentication will be attempted if available, otherwise
     * the code will fall back to legacy authentication.
     *
     * @param req - The current request.
     * @param _callback - low level (xmpp) connect callback function.
     *     Useful for plugins with their own xmpp connect callback (when they
     *     want to do something special).
     * @param raw - The stanza as raw string.
     */
    _connect_cb(req, _callback, raw) {
        log.debug('_connect_cb was called');
        this.connected = true;
        let bodyWrap;
        try {
            bodyWrap = (this._proto instanceof Bosh ? this._proto._reqToData(req) : req);
        }
        catch (e) {
            if (e.name !== ErrorCondition.BAD_FORMAT) {
                throw e;
            }
            this._changeConnectStatus(Status.CONNFAIL, ErrorCondition.BAD_FORMAT);
            this._doDisconnect(ErrorCondition.BAD_FORMAT);
        }
        if (!bodyWrap) {
            return;
        }
        if (this.xmlInput !== Connection.prototype.xmlInput) {
            if (bodyWrap.nodeName === this._proto.strip && bodyWrap.childNodes.length) {
                this.xmlInput(bodyWrap.childNodes[0]);
            }
            else {
                this.xmlInput(bodyWrap);
            }
        }
        if (this.rawInput !== Connection.prototype.rawInput) {
            if (raw) {
                this.rawInput(raw);
            }
            else {
                this.rawInput(Builder.serialize(bodyWrap));
            }
        }
        const conncheck = this._proto._connect_cb(bodyWrap);
        if (conncheck === Status.CONNFAIL) {
            return;
        }
        // Check for the stream:features tag
        let hasFeatures;
        if (bodyWrap.getElementsByTagNameNS) {
            hasFeatures = bodyWrap.getElementsByTagNameNS(NS.STREAM, 'features').length > 0;
        }
        else {
            hasFeatures =
                bodyWrap.getElementsByTagName('stream:features').length > 0 ||
                    bodyWrap.getElementsByTagName('features').length > 0;
        }
        if (!hasFeatures) {
            this._proto._no_auth_received(_callback);
            return;
        }
        const matched = Array.from(bodyWrap.getElementsByTagName('mechanism'))
            .map((m) => this.mechanisms[m.textContent])
            .filter((m) => m);
        if (matched.length === 0) {
            if (bodyWrap.getElementsByTagName('auth').length === 0) {
                // There are no matching SASL mechanisms and also no legacy
                // auth available.
                this._proto._no_auth_received(_callback);
                return;
            }
        }
        if (this.do_authentication !== false) {
            this.authenticate(matched);
        }
    }
    /**
     * Sorts an array of objects with prototype SASLMechanism according to
     * their priorities.
     * @param mechanisms - Array of SASL mechanisms.
     */
    sortMechanismsByPriority(mechanisms) {
        // Sorting mechanisms according to priority.
        for (let i = 0; i < mechanisms.length - 1; ++i) {
            let higher = i;
            for (let j = i + 1; j < mechanisms.length; ++j) {
                if (mechanisms[j].priority > mechanisms[higher].priority) {
                    higher = j;
                }
            }
            if (higher !== i) {
                const swap = mechanisms[i];
                mechanisms[i] = mechanisms[higher];
                mechanisms[higher] = swap;
            }
        }
        return mechanisms;
    }
    /**
     * Set up authentication
     *
     * Continues the initial connection request by setting up authentication
     * handlers and starting the authentication process.
     *
     * SASL authentication will be attempted if available, otherwise
     * the code will fall back to legacy authentication.
     *
     * @param matched - Array of SASL mechanisms supported.
     */
    authenticate(matched) {
        if (!this._attemptSASLAuth(matched)) {
            this._attemptLegacyAuth();
        }
    }
    /**
     * Iterate through an array of SASL mechanisms and attempt authentication
     * with the highest priority (enabled) mechanism.
     *
     * @private
     * @param mechanisms - Array of SASL mechanisms.
     * @return mechanism_found - true or false, depending on whether a
     *  valid SASL mechanism was found with which authentication could be started.
     */
    _attemptSASLAuth(mechanisms) {
        mechanisms = this.sortMechanismsByPriority(mechanisms || []);
        let mechanism_found = false;
        for (let i = 0; i < mechanisms.length; ++i) {
            if (!mechanisms[i].test(this)) {
                continue;
            }
            this._sasl_success_handler = this._addSysHandler(this._sasl_success_cb.bind(this), null, 'success', null, null);
            this._sasl_failure_handler = this._addSysHandler(this._sasl_failure_cb.bind(this), null, 'failure', null, null);
            this._sasl_challenge_handler = this._addSysHandler(this._sasl_challenge_cb.bind(this), null, 'challenge', null, null);
            this._sasl_mechanism = mechanisms[i];
            this._sasl_mechanism.onStart(this);
            const request_auth_exchange = $build('auth', {
                'xmlns': NS.SASL,
                'mechanism': this._sasl_mechanism.mechname,
            });
            if (this._sasl_mechanism.isClientFirst) {
                const response = this._sasl_mechanism.clientChallenge(this);
                request_auth_exchange.t(btoa(response));
            }
            this.send(request_auth_exchange.tree());
            mechanism_found = true;
            break;
        }
        return mechanism_found;
    }
    /**
     * _Private_ handler for the SASL challenge
     * @private
     * @param elem
     */
    _sasl_challenge_cb(elem) {
        return __awaiter(this, void 0, void 0, function* () {
            const challenge = atob(getText(elem));
            const response = yield this._sasl_mechanism.onChallenge(this, challenge);
            const stanza = $build('response', { 'xmlns': NS.SASL });
            if (response)
                stanza.t(btoa(response));
            this.send(stanza.tree());
            return true;
        });
    }
    /**
     * Attempt legacy (i.e. non-SASL) authentication.
     * @private
     */
    _attemptLegacyAuth() {
        if (getNodeFromJid(this.jid) === null) {
            // we don't have a node, which is required for non-anonymous
            // client connections
            this._changeConnectStatus(Status.CONNFAIL, ErrorCondition.MISSING_JID_NODE);
            this.disconnect(ErrorCondition.MISSING_JID_NODE);
        }
        else {
            // Fall back to legacy authentication
            this._changeConnectStatus(Status.AUTHENTICATING, null);
            this._addSysHandler(this._onLegacyAuthIQResult.bind(this), null, null, null, '_auth_1');
            this.send($iq({
                'type': 'get',
                'to': this.domain,
                'id': '_auth_1',
            })
                .c('query', { xmlns: NS.AUTH })
                .c('username', {})
                .t(getNodeFromJid(this.jid))
                .tree());
        }
    }
    /**
     * _Private_ handler for legacy authentication.
     *
     * This handler is called in response to the initial <iq type='get'/>
     * for legacy authentication.  It builds an authentication <iq/> and
     * sends it, creating a handler (calling back to _auth2_cb()) to
     * handle the result
     * @private
     * @return `false` to remove the handler.
     */
    _onLegacyAuthIQResult() {
        const pass = typeof this.pass === 'string' ? this.pass : '';
        // build plaintext auth iq
        const iq = $iq({ type: 'set', id: '_auth_2' })
            .c('query', { xmlns: NS.AUTH })
            .c('username', {})
            .t(getNodeFromJid(this.jid))
            .up()
            .c('password')
            .t(pass);
        if (!getResourceFromJid(this.jid)) {
            // since the user has not supplied a resource, we pick
            // a default one here.  unlike other auth methods, the server
            // cannot do this for us.
            this.jid = getBareJidFromJid(this.jid) + '/strophe';
        }
        iq.up().c('resource', {}).t(getResourceFromJid(this.jid));
        this._addSysHandler(this._auth2_cb.bind(this), null, null, null, '_auth_2');
        this.send(iq.tree());
        return false;
    }
    /**
     * _Private_ handler for succesful SASL authentication.
     * @private
     * @param elem - The matching stanza.
     * @return `false` to remove the handler.
     */
    _sasl_success_cb(elem) {
        if (this._sasl_data['server-signature']) {
            let serverSignature;
            const success = atob(getText(elem));
            const attribMatch = /([a-z]+)=([^,]+)(,|$)/;
            const matches = success.match(attribMatch);
            if (matches[1] === 'v') {
                serverSignature = matches[2];
            }
            if (serverSignature !== this._sasl_data['server-signature']) {
                // remove old handlers
                this.deleteHandler(this._sasl_failure_handler);
                this._sasl_failure_handler = null;
                if (this._sasl_challenge_handler) {
                    this.deleteHandler(this._sasl_challenge_handler);
                    this._sasl_challenge_handler = null;
                }
                this._sasl_data = {};
                return this._sasl_failure_cb(null);
            }
        }
        log.info('SASL authentication succeeded.');
        if (this._sasl_data.keys) {
            this.scram_keys = this._sasl_data.keys;
        }
        if (this._sasl_mechanism) {
            this._sasl_mechanism.onSuccess();
        }
        // remove old handlers
        this.deleteHandler(this._sasl_failure_handler);
        this._sasl_failure_handler = null;
        if (this._sasl_challenge_handler) {
            this.deleteHandler(this._sasl_challenge_handler);
            this._sasl_challenge_handler = null;
        }
        const streamfeature_handlers = [];
        const wrapper = (handlers, elem) => {
            while (handlers.length) {
                this.deleteHandler(handlers.pop());
            }
            this._onStreamFeaturesAfterSASL(elem);
            return false;
        };
        streamfeature_handlers.push(this._addSysHandler((elem) => wrapper(streamfeature_handlers, elem), null, 'stream:features', null, null));
        streamfeature_handlers.push(this._addSysHandler((elem) => wrapper(streamfeature_handlers, elem), NS.STREAM, 'features', null, null));
        // we must send an xmpp:restart now
        this._sendRestart();
        return false;
    }
    /**
     * @private
     * @param elem - The matching stanza.
     * @return `false` to remove the handler.
     */
    _onStreamFeaturesAfterSASL(elem) {
        var _a;
        // save stream:features for future usage
        this.features = elem;
        for (let i = 0; i < elem.childNodes.length; i++) {
            const child = elem.childNodes[i];
            if (child.nodeName === 'bind') {
                this.do_bind = true;
            }
            if (child.nodeName === 'session') {
                this.do_session = true;
            }
            if (this.sm && child.nodeName === 'sm' && child.namespaceURI === NS.SM) {
                this.sm.serverSupported = true;
            }
        }
        if ((_a = this.sm) === null || _a === void 0 ? void 0 : _a.serverSupported) {
            if (this.options.worker) {
                // Only the worker knows whether resumable state exists: it
                // either sends <resume/> itself (answering _smResumed or
                // _smFailed) or replies _smNoState, upon which the
                // connection proceeds to bind (see WorkerWebsocket).
                this._proto._smFeatures();
                return false;
            }
            // SM is only negotiated over websocket. Checked here on the
            // live transport because the transport can be swapped after
            // construction (e.g. XEP-0156 discovery).
            if (this._proto instanceof Websocket) {
                this.sm.initialize(this.jid);
                if (this.sm.hasResumableState()) {
                    // Attempt XEP-0198 stream resumption instead of binding a resource.
                    this._registerSMHandlers();
                    this.sm.sendResume();
                    return false;
                }
            }
        }
        this._proceedToBind();
        return false;
    }
    /**
     * Continue the connect flow with resource binding, once it is clear no
     * XEP-0198 resumption will happen (no SM support, no resumable state, a
     * failed <resume/>, or the shared worker reporting _smNoState).
     */
    _proceedToBind() {
        if (!this.do_bind) {
            this._changeConnectStatus(Status.AUTHFAIL, null);
        }
        else if (!this.options.explicitResourceBinding) {
            this.bind();
        }
        else {
            this._changeConnectStatus(Status.BINDREQUIRED, null);
        }
    }
    /**
     * Register the XEP-0198 nonza handlers (idempotently)
     * They are system handlers, so they run before authentication completes,
     * which the resume flow requires.
     */
    _registerSMHandlers() {
        this._smHandlers.forEach((h) => this.deleteHandler(h));
        const delegate = (el) => {
            this.sm.onInbound(toStanzaView(el));
            return true;
        };
        this._smHandlers = [
            this._addSysHandler(delegate, NS.SM, 'r', null, null),
            this._addSysHandler(delegate, NS.SM, 'a', null, null),
            this._addSysHandler(delegate, NS.SM, 'enabled', null, null),
            this._addSysHandler((el) => this._onStreamResumed(el), NS.SM, 'resumed', null, null),
            this._addSysHandler((el) => this._onStreamResumptionFailed(el), NS.SM, 'failed', null, null),
        ];
    }
    /**
     * _Private_ handler for a successful XEP-0198 stream resumption.
     *
     * The engine reconciles the server's 'h' and re-sends whatever the
     * server didn't acknowledge.
     *
     * The connection state is restored, `this.jid` is set back to the JID that
     * was bound when the SM session was established, *before* CONNECTED is emitted,
     * so no stanza can ever be stamped with a resource the server doesn't know.
     * @param elem - The <resumed/> nonza.
     * @return `true` to keep the handler.
     */
    _onStreamResumed(elem) {
        this.sm.onInbound(toStanzaView(elem));
        this.do_bind = false;
        this.authenticated = true;
        this.restored = true;
        this.jid = this.sm.boundJid;
        this._changeConnectStatus(Status.CONNECTED, null);
        return true;
    }
    /**
     * _Private_ handler for a failed <enable/> or <resume/>.
     *
     * The engine resets its state; after a failed *resumption* it also
     * salvages the unacked queue (re-sent once a fresh session reaches
     * <enabled/>), and the connection falls back to binding a resource on
     * this same stream, per XEP-0198 ("the server SHOULD allow the client
     * to bind a resource at this point"). A refused <enable/> needs neither:
     * the stream is alive and bound, it just runs without SM.
     * @param elem - The <failed/> nonza.
     * @return `true` to keep the handler.
     */
    _onStreamResumptionFailed(elem) {
        // Read before feeding the nonza to the engine, which clears the flag.
        const resuming = this.sm.resumePending;
        this.sm.onInbound(toStanzaView(elem));
        if (resuming) {
            this.do_bind = true;
            this._proceedToBind();
        }
        return true;
    }
    /**
     * Called at the CONNECTED-emission points of the connect flow, just
     * before CONNECTED is emitted i.e. once the full JID is final (resource
     * bound, legacy session established, or legacy auth completed).
     *
     * Under the `worker` option the bound JID is always reported to the
     * shared worker — with or without Stream Management — so it can hand the
     * right JID to attaching tabs, release joins parked on the handshake,
     * and (when this stream's features advertised SM) start a fresh SM
     * session itself (it answers with _smEnabled, which updates the mirror).
     *
     * Otherwise, if the server supports XEP-0198 and nothing was resumed,
     * a fresh SM session is started from here. The XEP allows <enable/> any
     * time after binding.
     */
    _onSessionReady() {
        var _a;
        if (this.options.worker) {
            this._proto._bound(this.jid);
            return;
        }
        if (!((_a = this.sm) === null || _a === void 0 ? void 0 : _a.serverSupported) || this.sm.resumed || !(this._proto instanceof Websocket)) {
            return;
        }
        if (!this.sm.isTracking()) {
            this._registerSMHandlers();
            this.sm.sendEnable(this.jid);
        }
    }
    /**
     * Sends an IQ to the XMPP server to bind a JID resource for this session.
     *
     * https://tools.ietf.org/html/rfc6120#section-7.5
     *
     * If `explicitResourceBinding` was set to a truthy value in the options
     * passed to the Connection constructor, then this function needs
     * to be called explicitly by the client author.
     *
     * Otherwise it'll be called automatically as soon as the XMPP server
     * advertises the "urn:ietf:params:xml:ns:xmpp-bind" stream feature.
     */
    bind() {
        if (!this.do_bind) {
            log.info(`Connection.prototype.bind called but "do_bind" is false`);
            return;
        }
        this._addSysHandler(this._onResourceBindResultIQ.bind(this), null, null, null, '_bind_auth_2');
        const resource = getResourceFromJid(this.jid);
        if (resource) {
            this.send($iq({ type: 'set', id: '_bind_auth_2' })
                .c('bind', { xmlns: NS.BIND })
                .c('resource', {})
                .t(resource)
                .tree());
        }
        else {
            this.send($iq({ type: 'set', id: '_bind_auth_2' }).c('bind', { xmlns: NS.BIND }).tree());
        }
    }
    /**
     * _Private_ handler for binding result and session start.
     * @private
     * @param elem - The matching stanza.
     * @return `false` to remove the handler.
     */
    _onResourceBindResultIQ(elem) {
        if (elem.getAttribute('type') === 'error') {
            log.warn('Resource binding failed.');
            const conflict = elem.getElementsByTagName('conflict');
            let condition;
            if (conflict.length > 0) {
                condition = ErrorCondition.CONFLICT;
            }
            this._changeConnectStatus(Status.AUTHFAIL, condition, elem);
            return false;
        }
        // TODO - need to grab errors
        const bind = elem.getElementsByTagName('bind');
        if (bind.length > 0) {
            const jidNode = bind[0].getElementsByTagName('jid');
            if (jidNode.length > 0) {
                this.authenticated = true;
                this.jid = getText(jidNode[0]);
                if (this.do_session) {
                    this._establishSession();
                }
                else {
                    this._onSessionReady();
                    this._changeConnectStatus(Status.CONNECTED, null);
                }
            }
        }
        else {
            log.warn('Resource binding failed.');
            this._changeConnectStatus(Status.AUTHFAIL, null, elem);
            return false;
        }
    }
    /**
     * Send IQ request to establish a session with the XMPP server.
     *
     * See https://xmpp.org/rfcs/rfc3921.html#session
     *
     * Note: The protocol for session establishment has been determined as
     * unnecessary and removed in RFC-6121.
     * @private
     */
    _establishSession() {
        if (!this.do_session) {
            throw new Error(`Connection.prototype._establishSession ` +
                `called but apparently ${NS.SESSION} wasn't advertised by the server`);
        }
        this._addSysHandler(this._onSessionResultIQ.bind(this), null, null, null, '_session_auth_2');
        this.send($iq({ type: 'set', id: '_session_auth_2' }).c('session', { xmlns: NS.SESSION }).tree());
    }
    /**
     * _Private_ handler for the server's IQ response to a client's session
     * request.
     *
     * This sets Connection.authenticated to true on success, which
     * starts the processing of user handlers.
     *
     * See https://xmpp.org/rfcs/rfc3921.html#session
     *
     * Note: The protocol for session establishment has been determined as
     * unnecessary and removed in RFC-6121.
     * @private
     * @param elem - The matching stanza.
     * @return `false` to remove the handler.
     */
    _onSessionResultIQ(elem) {
        if (elem.getAttribute('type') === 'result') {
            this.authenticated = true;
            this._onSessionReady();
            this._changeConnectStatus(Status.CONNECTED, null);
        }
        else if (elem.getAttribute('type') === 'error') {
            this.authenticated = false;
            log.warn('Session creation failed.');
            this._changeConnectStatus(Status.AUTHFAIL, null, elem);
            return false;
        }
        return false;
    }
    /**
     * _Private_ handler for SASL authentication failure.
     * @param elem - The matching stanza.
     * @return `false` to remove the handler.
     */
    _sasl_failure_cb(elem) {
        // delete unneeded handlers
        if (this._sasl_success_handler) {
            this.deleteHandler(this._sasl_success_handler);
            this._sasl_success_handler = null;
        }
        if (this._sasl_challenge_handler) {
            this.deleteHandler(this._sasl_challenge_handler);
            this._sasl_challenge_handler = null;
        }
        if (this._sasl_mechanism)
            this._sasl_mechanism.onFailure();
        this._changeConnectStatus(Status.AUTHFAIL, null, elem);
        return false;
    }
    /**
     * _Private_ handler to finish legacy authentication.
     *
     * This handler is called when the result from the jabber:iq:auth
     * <iq/> stanza is returned.
     * @private
     * @param elem - The stanza that triggered the callback.
     * @return `false` to remove the handler.
     */
    _auth2_cb(elem) {
        if (elem.getAttribute('type') === 'result') {
            this.authenticated = true;
            this._onSessionReady();
            this._changeConnectStatus(Status.CONNECTED, null);
        }
        else if (elem.getAttribute('type') === 'error') {
            this._changeConnectStatus(Status.AUTHFAIL, null, elem);
            this.disconnect('authentication failed');
        }
        return false;
    }
    /**
     * _Private_ function to add a system level timed handler.
     *
     * This function is used to add a TimedHandler for the
     * library code.  System timed handlers are allowed to run before
     * authentication is complete.
     * @param period - The period of the handler.
     * @param handler - The callback function.
     */
    _addSysTimedHandler(period, handler) {
        const thand = new TimedHandler(period, handler);
        thand.user = false;
        this.addTimeds.push(thand);
        return thand;
    }
    /**
     * _Private_ function to add a system level stanza handler.
     *
     * This function is used to add a Handler for the
     * library code.  System stanza handlers are allowed to run before
     * authentication is complete.
     * @param handler - The callback function.
     * @param ns - The namespace to match.
     * @param name - The stanza name to match.
     * @param type - The stanza type attribute to match.
     * @param id - The stanza id attribute to match.
     */
    _addSysHandler(handler, ns, name, type, id) {
        const hand = new Handler(handler, ns, name, type, id, null);
        hand.user = false;
        this.addHandlers.push(hand);
        return hand;
    }
    /**
     * _Private_ timeout handler for handling non-graceful disconnection.
     *
     * If the graceful disconnect process does not complete within the
     * time allotted, this handler finishes the disconnect anyway.
     * @return `false` to remove the handler.
     */
    _onDisconnectTimeout() {
        log.debug('_onDisconnectTimeout was called');
        this._changeConnectStatus(Status.CONNTIMEOUT, null);
        this._proto._onDisconnectTimeout();
        // actually disconnect
        this._doDisconnect();
        return false;
    }
    /**
     * (Re)arm the idle loop.
     *
     * Cancels any pending idle tick and schedules the next call to
     * {@link Connection#_onIdle}. `_onIdle` re-arms itself while connected, so
     * this only needs to be called to (re)start the loop: at construction, on a
     * stream restart, or when a transport becomes connected without having gone
     * through the send path (e.g. a receive-only component after its handshake).
     * @private
     */
    _scheduleIdle() {
        clearTimeout(this._idleTimeout);
        this._idleTimeout = setTimeout(() => this._onIdle(), 100);
    }
    /**
     * _Private_ handler to process events during idle cycle.
     *
     * This handler is called every 100ms to fire timed handlers that
     * are ready and keep poll requests going.
     */
    _onIdle() {
        // add timed handlers scheduled for addition
        // NOTE: we add before remove in the case a timed handler is
        // added and then deleted before the next _onIdle() call.
        while (this.addTimeds.length > 0) {
            this.timedHandlers.push(this.addTimeds.pop());
        }
        // remove timed handlers that have been scheduled for deletion
        while (this.removeTimeds.length > 0) {
            const thand = this.removeTimeds.pop();
            const i = this.timedHandlers.indexOf(thand);
            if (i >= 0) {
                this.timedHandlers.splice(i, 1);
            }
        }
        // call ready timed handlers
        const now = new Date().getTime();
        const newList = [];
        for (let i = 0; i < this.timedHandlers.length; i++) {
            const thand = this.timedHandlers[i];
            if (this.authenticated || !thand.user) {
                const since = thand.lastCalled + thand.period;
                if (since - now <= 0) {
                    if (thand.run()) {
                        newList.push(thand);
                    }
                }
                else {
                    newList.push(thand);
                }
            }
        }
        this.timedHandlers = newList;
        clearTimeout(this._idleTimeout);
        this._proto._onIdle();
        // reactivate the timer only if connected
        if (this.connected) {
            this._idleTimeout = setTimeout(() => this._onIdle(), 100);
        }
    }
}

var _Stanza_instances, _a, _Stanza_strings, _Stanza_values, _Stanza_expand, _Stanza_expandValue;
class UnsafeXML extends String {
}
/**
 * The whitespace in an `stx` template has two origins which mean opposite
 * things. The static parts of the template are markup, so the line breaks and
 * indentation between their tags are formatting and is stripped. Text
 * interpolated with `${}` is considered content and its whitespace is kept.
 *
 * Interpolated values are therefore never written into the text which is
 * parsed. Instead, a processing instruction stands in for it, and is replaced
 * by the value's nodes once the tree exists. The processing instruction's name
 * is `${SLOT}-${slotSeq}`, where `slotSeq` is the incrementing number for each
 * expansion.
 *
 * The random part of the name keeps a value which is written into the template
 * text verbatim, as one inside a tag or at document level is, from naming a
 * slot by accident. It is not what stops such a value from naming one on
 * purpose. {@link assertFilled} is, by requiring that every slot be accounted
 * for exactly once, so do not read the name as a secret.
 */
const SLOT = `strophe-slot-${Math.random().toString(36).slice(2)}`;
/** Gives each expansion a {@link SLOT} of its own. */
let slotSeq = 0;
/** The element a fragment of spliced-in markup is parsed inside. */
const FRAGMENT = 'strophe-fragment';
/**
 * A cursor placed at the start of a template. A nested template shares it, so
 * the whole stanza is expanded with the one slot name and filled in one pass.
 */
function newCursor() {
    return {
        mode: 'text',
        quote: '',
        depth: 0,
        element: false,
        prev: '',
        tail: 0,
        opened: false,
        slot: `${SLOT}-${slotSeq++}`,
    };
}
/**
 * The run of text ended in the middle of what it was reading. The construct
 * carries on into the next run, so the cursor is left in the mode it reached.
 */
const EXHAUSTED = -1;
/**
 * Element content, up to the `<` which ends it.
 *
 * What follows the `<` says what was opened. A comment, a CDATA section and a
 * processing instruction are read whole by {@link scanDelimited}; everything
 * else is a tag, and only some tags are an element's.
 */
function scanText(xml, i, cursor) {
    const lt = xml.indexOf('<', i);
    if (lt === -1)
        return EXHAUSTED;
    if (xml.startsWith('<!--', lt)) {
        cursor.mode = 'comment';
        return lt + 4;
    }
    if (xml.startsWith('<![CDATA[', lt)) {
        cursor.mode = 'cdata';
        cursor.tail = 0;
        cursor.opened = false;
        return lt + 9;
    }
    // A processing instruction has no attributes, so a quote in one is a
    // character like any other, and the `?>` which ends it is a token like the
    // `-->` which ends a comment. Read as a tag, a PI holding an apostrophe
    // left the cursor inside an attribute value for the rest of the template,
    // and every value after it was written out as though it were in one.
    if (xml.startsWith('<?', lt)) {
        cursor.mode = 'pi';
        return lt + 2;
    }
    // A declaration is not an element, so it encloses nothing.
    const next = xml[lt + 1];
    cursor.element = next !== '!';
    if (cursor.element)
        cursor.depth += next === '/' ? -1 : 1;
    cursor.mode = 'tag';
    cursor.prev = '';
    return lt + 1;
}
/**
 * The inside of a tag, a character at a time, up to the `>` which ends it.
 *
 * A character at a time because a `>` inside an attribute value does not end
 * the tag, so the quoting has to be followed through, and because whether the
 * tag closed the element it opened is only readable from the character before
 * the `>`.
 */
function scanTag(xml, i, cursor) {
    const c = xml[i];
    if (cursor.quote) {
        // Inside an attribute value, where only its own closing quote counts.
        if (c === cursor.quote)
            cursor.quote = '';
    }
    else if (c === '"' || c === "'") {
        cursor.quote = c;
    }
    else if (c === '>') {
        // `<a/>` opened and closed an element in the one tag.
        if (cursor.element && cursor.prev === '/')
            cursor.depth--;
        cursor.mode = 'text';
    }
    cursor.prev = c;
    return i + 1;
}
const CLOSERS = { pi: '?>', comment: '-->', cdata: ']]>' };
/**
 * A processing instruction, a comment or a CDATA section, up to its closing
 * token.
 *
 * All three are opaque. What they hold is not markup, so there is nothing in
 * there to count and nowhere in there to stand a value.
 *
 * A run can end part-way through a `]]>`, with the `]` in this run and the `>`
 * in the next. Neither run holds the token, so a search of either finds
 * nothing, yet the parser reads the two as one text and closes the section
 * there. The `]` a CDATA run ends in are therefore counted into
 * {@link Cursor.tail}, for {@link emit} to hold against the run which follows.
 * Two are all a `]]>` can use, so no more are counted.
 */
function scanDelimited(xml, i, cursor) {
    const close = CLOSERS[cursor.mode];
    const end = xml.indexOf(close, i);
    if (end === -1) {
        if (cursor.mode === 'cdata')
            cursor.tail = Math.min(2, /\]*$/.exec(xml.slice(i))[0].length);
        return EXHAUSTED;
    }
    cursor.mode = 'text';
    cursor.tail = 0;
    return end + close.length;
}
/**
 * How each mode reads. Keyed by every mode there is, so a new one cannot be
 * added to {@link Cursor} without saying how to read it.
 */
const SCANNERS = {
    text: scanText,
    tag: scanTag,
    pi: scanDelimited,
    comment: scanDelimited,
    cdata: scanDelimited,
};
/**
 * Read a run of template text, leaving the cursor where that text ended.
 *
 * This is a lexer that answers the question where in the markup the next value
 * lands, because that decides whether it can be represented by a processing
 * instruction or has to be written out verbatim.
 *
 * The parser can't answer this because it needs the finished text with every
 * interpolated value already written, but the way the values are written (i.e.
 * with or without whitespace) depends on the answer.
 *
 * It is deliberately not a validator and rejects nothing, since the parser will
 * validate a moment later and will say it better. All it has to get right is which
 * of three places the text ended in, and how many elements are open there:
 *
 * - in element content, where a value can be stood in for by a processing
 *   instruction, so long as an element encloses it
 * - inside a tag, where no processing instruction can go, so the value is
 *   written out instead
 * - inside a processing instruction, a comment or a CDATA section, likewise
 */
function scan(xml, cursor) {
    let i = 0;
    while (i !== EXHAUSTED && i < xml.length) {
        i = SCANNERS[cursor.mode](xml, i, cursor);
    }
}
/**
 * Write text into the template, keeping the cursor in step with it.
 *
 * Everything which ends up in the text that is parsed goes through here, so
 * the cursor has read what the parser will read. A value written verbatim can
 * open or close a tag just as a static part of the template can, and if the
 * cursor did not see it the two would disagree about where the next value
 * lands. A value at document level is read like any other; what it opens is
 * simply not counted, which {@link Stanza.expandValue} arranges by putting
 * {@link Cursor.depth} back afterwards.
 *
 * Inside a CDATA section the parser reads one run into the next, so a `]]>`
 * which begins in the run before this one and ends in this one would close the
 * section where neither run wrote a close, and the rest of this run would be
 * read as markup. A value in a CDATA section is written as characters, so it
 * ends in whatever it ends in and is followed by whatever the template or the
 * next value begins with, and the two can meet that way. The section is closed
 * and opened again between them instead, and the parser reads the `]` and the
 * `>` as the character data they were.
 */
function emit(xml, cursor) {
    if (cursor.mode === 'cdata' && closesAcross(cursor.tail, xml)) {
        xml = `]]><![CDATA[${xml}`;
    }
    scan(xml, cursor);
    return xml;
}
/**
 * Whether the first `]]>` the parser would read begins in the `]` the CDATA
 * section's text so far ended in, which {@link Cursor.tail} counts, and ends in
 * this run. One which begins in this run is the run's own: the template's
 * closing token, or a `]]>` {@link serializeIntoCdata} has already split.
 */
function closesAcross(tail, xml) {
    const at = (']'.repeat(tail) + xml).indexOf(']]>');
    return at !== -1 && at < tail;
}
/**
 * A value as it is written into the template text, where what surrounds it is
 * markup and a string has to be escaped to be read as the characters it holds.
 */
function serializeValue(value) {
    if (Array.isArray(value))
        return value.map(serializeValue).join('');
    if (value instanceof UnsafeXML || value instanceof Builder)
        return value.toString();
    return xmlescape((value !== null && value !== void 0 ? value : '').toString());
}
/**
 * A value as it is written inside an attribute value.
 *
 * The one position where a parser rewrites what it reads: it flattens the
 * whitespace in an attribute value, so a value's own whitespace would be lost
 * on its way through the parser, in the one position where a value cannot be
 * stood in for and so has to go through it at all. {@link attributeWhitespace}
 * writes it so that it is read back as it was, as {@link Builder.serialize}
 * does for an attribute set by hand, and the two agree.
 *
 * Interpolated markup is left as it stands, as it is everywhere else. An
 * attribute value holds no markup, so `unsafeXML` there says the text is already
 * written the way it is meant to be read.
 */
function serializeIntoAttribute(value) {
    if (Array.isArray(value))
        return value.map(serializeIntoAttribute).join('');
    if (value instanceof UnsafeXML || value instanceof Builder)
        return value.toString();
    return attributeWhitespace(xmlescape(xmlText((value !== null && value !== void 0 ? value : '').toString(), 'An interpolated value')));
}
/**
 * A value as its own characters, with nothing escaped and no markup meant.
 */
function characterData(value) {
    if (Array.isArray(value))
        return value.map(characterData).join('');
    if (value instanceof UnsafeXML || value instanceof Builder)
        return value.toString();
    return (value !== null && value !== void 0 ? value : '').toString();
}
/**
 * A value as it is written inside a CDATA section.
 *
 * A CDATA section escapes nothing. Everything up to the `]]>` which ends it is
 * character data as it stands, so a value goes in as its own characters: an `&`
 * written `&amp;` in there is read back as those five characters rather than as
 * an ampersand, which is what escaping it did.
 *
 * `]]>` is the one sequence a value cannot carry, since it would end the
 * section early and leave the rest of the value to be read as markup. XML has
 * no escape for it, so the section is closed and opened again around it: the
 * `]]` ends the first section and the `>` begins the second, and the two are
 * read back as one run of character data. {@link scanDelimited} follows the
 * same pair, so the cursor comes out of this still inside a CDATA section,
 * which is where the template left it.
 *
 * Splitting after the parts are joined rather than within each of them is what
 * catches a `]]>` which only exists because one part ended in `]]` and the next
 * began with `>`. The same can happen at either end of the value, between it
 * and the template text or the value beside it, which nothing here can see:
 * {@link emit} catches that one, since it reads every run against the one
 * before it.
 */
function serializeIntoCdata(value) {
    return characterData(value).split(']]>').join(']]]]><![CDATA[>');
}
/**
 * @param node
 * @param slot - The target this expansion stands its values in.
 */
function isSlot(node, slot) {
    return !!node && node.nodeType === ElementType.PROCESSING_INSTRUCTION && node.nodeName === slot;
}
/**
 * Whether the node next to a run of template whitespace is a value which puts
 * text with something in it against it. Whitespace between two elements is
 * formatting, but whitespace next to text is part of that text.
 *
 * A value is asked about the end of it which faces the whitespace: the value
 * before a run faces it with its last node, the one after it with its first.
 * A string contributes the one text node, so both ends are the same node and
 * the question is simply whether the string has anything in it. Spliced-in
 * markup can begin in text and end in an element, or the other way about, so
 * the two ends are asked separately.
 *
 * A value which resolved to no nodes is looked past rather than answered for.
 * It puts nothing against the whitespace, so what the whitespace touches is
 * whatever lies beyond it. Answering `false` there would let an unrelated
 * optional value shadow the one next to it, and the line break in
 * `<body>\n${prefix}${text}</body>` would survive or not according to whether
 * `prefix` happened to be set.
 *
 * @param node - The sibling on that side of the whitespace, if there is one.
 * @param edge - The end of the value which faces the whitespace. Also says
 *  which way to keep looking when a value which resolved to nothing is passed
 *  over: `first` is the side after the whitespace, `last` the side before it.
 */
function abutsText(node, slot, resolved, edge) {
    let sibling = node;
    while (isSlot(sibling, slot)) {
        const nodes = resolved.get(sibling);
        if (!(nodes === null || nodes === void 0 ? void 0 : nodes.length)) {
            sibling = edge === 'first' ? sibling.nextSibling : sibling.previousSibling;
            continue;
        }
        const end = nodes[edge === 'first' ? 0 : nodes.length - 1];
        // A CDATA section is text written another way, so it counts as text here.
        if (end.nodeType !== ElementType.TEXT && end.nodeType !== ElementType.CDATA)
            return false;
        return /\S/.test(end.nodeValue);
    }
    return false;
}
/**
 * The namespace declarations in scope at an element, written out as they would
 * appear on a tag.
 *
 * Every value under the one element is parsed in the same scope, so this is
 * worked out once per element in {@link resolve} rather than once per value.
 * The walk is up the ancestors, so the nearest declaration of a prefix is the
 * one which is kept and the rest are passed over.
 */
function inScopeDeclarations(context) {
    const declarations = [];
    const seen = new Set();
    for (let el = context; el; el = el.parentElement) {
        Array.from(el.attributes).forEach(({ nodeName, value }) => {
            if (nodeName !== 'xmlns' && !nodeName.startsWith('xmlns:'))
                return;
            if (seen.has(nodeName))
                return;
            seen.add(nodeName);
            declarations.push(`${nodeName}="${xmlescape(value)}"`);
        });
    }
    return declarations.join(' ');
}
/**
 * Parse a fragment of markup as if it had been written where it was
 * interpolated, by repeating the namespace declarations in scope there.
 * Splicing markup in is then no different from writing it out in the template.
 */
function parseFragment(xml, declarations) {
    const doc = xmlHtmlNode(`<${FRAGMENT} ${declarations}>${xml}</${FRAGMENT}>`);
    const parserError = getParserError(doc);
    if (parserError) {
        throw new Error(`Parser Error: markup interpolated into an stx template must be well-formed on its own, ` +
            `and cannot open or close an element belonging to the template: ${xml}\n` +
            parserError.split(FRAGMENT).join('the enclosing element'));
    }
    return Array.from(getFirstElementChild(doc).childNodes);
}
/**
 * The nodes a value contributes where it was interpolated.
 *
 * Markup is moved into the stanza's document rather than copied into it. Its
 * own document was made to parse it and is dropped as soon as it has been read,
 * so there is nothing for a copy to leave behind, and the deep copy
 * `importNode` makes is the most expensive thing about splicing a value in.
 *
 * A value in element content becomes a text node without the parser reading it,
 * so it goes through {@link xmlText} for the same reasons a text node built by
 * {@link Builder} does. It cannot use {@link xmlTextNode} to make the node,
 * since the node has to belong to the document the template was parsed into.
 */
function nodesFor(value, context, declarations) {
    const doc = context.ownerDocument;
    if (value instanceof UnsafeXML || value instanceof Builder) {
        return parseFragment(value.toString(), declarations).map((node) => doc.adoptNode(node));
    }
    const text = xmlText((value !== null && value !== void 0 ? value : '').toString(), 'An interpolated value');
    return text ? [doc.createTextNode(text)] : [];
}
/**
 * Work out what each slot stands for, before any whitespace is weighed up.
 *
 * The template's whitespace next to a value is only formatting if what the
 * value puts there is not text, and that is a question about nodes rather than
 * about the string a value was written as. So the nodes have to exist before
 * {@link strip} runs, which means resolving here rather than at substitution.
 *
 * A slot addressing no value is left out, which is how {@link substitute} tells
 * one apart later without repeating the arithmetic.
 *
 * The namespace declarations every value under `el` is parsed in are the same,
 * so they are worked out at most once here, and only where there is a value to
 * parse: most elements have no slot under them at all.
 */
function resolve(el, slots, slot, resolved) {
    let declarations;
    Array.from(el.childNodes).forEach((node) => {
        if (isSlot(node, slot)) {
            const index = Number(node.data);
            if (Number.isInteger(index) && index >= 0 && index < slots.length) {
                if (declarations === undefined)
                    declarations = inScopeDeclarations(el);
                resolved.set(node, nodesFor(slots[index], el, declarations));
            }
        }
        else if (node.nodeType === ElementType.NORMAL) {
            resolve(node, slots, slot, resolved);
        }
    });
}
/**
 * Replace each slot with its value's nodes, recording what was found.
 *
 * The nodes a value contributes are inserted where its slot was and are not
 * descended into, so nothing which came from a value is ever rewritten. The
 * child list is read before anything is inserted, which is what keeps those
 * nodes out of the walk and so out of the tally: a value may hold a processing
 * instruction of its own, whatever it is called, without being read as a slot.
 *
 * A processing instruction the template wrote out itself has a target of its
 * own, so it isn't a slot and is passed over like any other node.
 */
function substitute(el, slot, resolved, tally) {
    Array.from(el.childNodes).forEach((node) => {
        if (isSlot(node, slot)) {
            const nodes = resolved.get(node);
            if (nodes) {
                tally.filled[Number(node.data)]++;
                nodes.forEach((child) => el.insertBefore(child, node));
            }
            else {
                // Resolving left it out, so it addresses no value at all and
                // stands in for nothing.
                tally.stray++;
            }
            el.removeChild(node);
        }
        else if (node.nodeType === ElementType.NORMAL) {
            substitute(node, slot, resolved, tally);
        }
    });
}
/**
 * Refuse to hand back a tree which doesn't account for every value exactly once.
 *
 * Each value is stood in for by one slot, so one slot has to come back.
 *
 * Fewer means a value never made it into the stanza. {@link Builder.serialize}
 * has no case for a processing instruction, so it would go out on the wire as
 * nothing at all, which is the silent loss this whole mechanism exists to
 * prevent. Markup written into the template text can cause it by leaving a slot
 * somewhere it stops being a node: inside a comment or a CDATA section it is
 * character data, and beside the root element it is outside the tree
 * {@link fill} walks.
 *
 * More means a slot came back which the template never wrote. The same markup
 * can put one there, and a slot is an address into the value list, so it would
 * let one value stand in for another. Refusing is the point: a value's markup
 * is its own and reaches no further.
 */
function assertFilled(tally) {
    if (tally.filled.some((count) => count === 0)) {
        throw new Error('An interpolated value never made it into the stanza. A value is only stood in for ' +
            'where an element encloses it, so markup written into the template text must not ' +
            'leave it inside a comment or a CDATA section, or beside the root element.');
    }
    if (tally.stray || tally.filled.some((count) => count > 1)) {
        throw new Error('Markup interpolated into the template carried a placeholder of its own. ' +
            'One value cannot stand in for another.');
    }
}
/**
 * Remove the whitespace which the template's own formatting put between its
 * tags, replace the slots with their values, and check that every value was
 * accounted for.
 *
 * The nodes a value stands for are worked out first, and put into the tree
 * last. Stripping in between is what keeps the two kinds of whitespace apart:
 * a value is still a slot while it runs, so it cannot delete one, and yet the
 * nodes exist, so the predicate can ask what a value actually puts against the
 * whitespace next to it.
 *
 * That is the one thing {@link strip} cannot tell on its own: whitespace
 * written between two interpolations is content when it separates text and
 * formatting when it separates elements, which is the distinction XML itself
 * draws between mixed and element-only content. Where the answer is not the
 * wanted one, `xml:space="preserve"` is the way out.
 */
function fill(el, slots, slot) {
    const resolved = new Map();
    resolve(el, slots, slot, resolved);
    strip(el, (node) => abutsText(node.previousSibling, slot, resolved, 'last') ||
        abutsText(node.nextSibling, slot, resolved, 'first'));
    const tally = { filled: new Array(slots.length).fill(0), stray: 0 };
    substitute(el, slot, resolved, tally);
    assertFilled(tally);
    prune(el);
    // Each value becomes nodes of its own, and a pruned comment leaves the text
    // either side of it apart, so text which reads as one run can be several
    // nodes. Merge them back into the one a parser would have built, which is
    // what 5.0.0 handed back when every value went through the parser.
    el.normalize();
}
/**
 * Remove the nodes a stanza cannot carry.
 *
 * RFC 6120 § 11.1 restricts an XML stream to a subset of XML which has neither
 * comments nor processing instructions, and {@link Builder.serialize} writes
 * neither. A template can hold both, in its own text or inside markup a value
 * spliced in, so a tree which kept them would describe a different stanza from
 * the one `toString()` and every transport put on the wire. Dropping them is
 * what keeps the tree and the wire the same answer.
 *
 * Dropped rather than refused because a comment is a reasonable thing to write
 * in a template, or to find in a fragment which came from somewhere else, and
 * neither is worth failing a stanza over. Nothing is lost that could have been
 * sent: writing one out invites the server to answer `restricted-xml` and close
 * the stream.
 *
 * Runs after {@link substitute}, which is the first moment the tree holds every
 * node it is going to hold. Before it, a slot is a processing instruction like
 * any other and would be dropped instead of filled, and the nodes a value
 * contributes are not in the tree yet to be looked at.
 */
function prune(el) {
    Array.from(el.childNodes).forEach((node) => {
        if (node.nodeType === ElementType.PROCESSING_INSTRUCTION || node.nodeType === ElementType.COMMENT) {
            el.removeChild(node);
        }
        else if (node.nodeType === ElementType.NORMAL) {
            prune(node);
        }
    });
}
/**
 * A Stanza represents a XML element used in XMPP (commonly referred to as stanzas).
 */
class Stanza extends Builder {
    constructor(strings, values) {
        super('stanza');
        _Stanza_instances.add(this);
        _Stanza_strings.set(this, void 0);
        _Stanza_values.set(this, void 0);
        __classPrivateFieldSet(this, _Stanza_strings, strings, "f");
        __classPrivateFieldSet(this, _Stanza_values, values, "f");
    }
    /**
     * A directive which can be used to pass a string of XML as a value to the
     * stx tagged template literal.
     *
     * It's considered "unsafe" because it can pose a security risk if used with
     * untrusted input.
     *
     * @example
     *    const status = '<status>I am busy!</status>';
     *    const pres = stx`
     *       <presence from='juliet@example.com/chamber' id='pres1'>
     *           <show>dnd</show>
     *           ${unsafeXML(status)}
     *       </presence>`;
     *    connection.send(pres);
     */
    static unsafeXML(string) {
        return new UnsafeXML(string);
    }
    /**
     * Turns the passed-in string into an XML Element.
     */
    static toElement(string, throwErrorIfInvalidNS) {
        const doc = xmlHtmlNode(string);
        const parserError = getParserError(doc);
        if (parserError) {
            throw new Error(`Parser Error: ${parserError}`);
        }
        const node = stripWhitespace(getFirstElementChild(doc));
        checkNamespace(node, throwErrorIfInvalidNS);
        return node;
    }
    /**
     * Build the stanza the template describes.
     */
    buildTree() {
        const slots = [];
        const cursor = newCursor();
        // Trimmed here and nowhere else. This is the whole template, so what is
        // cut lies outside the root element, where it is neither content nor
        // syntax and the parser would pass over it anyway. Nothing is scanned
        // afterwards either, so the cursor cannot be left describing text which
        // is no longer there, which is what the same trim did to a nested
        // template until it was taken out of {@link Stanza.expandValue}.
        const template = __classPrivateFieldGet(this, _Stanza_instances, "m", _Stanza_expand).call(this, slots, cursor).trim();
        const doc = xmlHtmlNode(template);
        const parserError = getParserError(doc);
        if (parserError) {
            throw new Error(`Parser Error: ${parserError}`);
        }
        const node = getFirstElementChild(doc);
        fill(node, slots, cursor.slot);
        checkNamespace(node, true);
        return node;
    }
}
_a = Stanza, _Stanza_strings = new WeakMap(), _Stanza_values = new WeakMap(), _Stanza_instances = new WeakSet(), _Stanza_expand = function _Stanza_expand(slots, cursor) {
    return __classPrivateFieldGet(this, _Stanza_strings, "f").reduce((acc, str, idx) => {
        acc += emit(str, cursor);
        if (__classPrivateFieldGet(this, _Stanza_values, "f").length <= idx)
            return acc;
        return acc + __classPrivateFieldGet(_a, _a, "m", _Stanza_expandValue).call(_a, __classPrivateFieldGet(this, _Stanza_values, "f")[idx], slots, cursor);
    }, '');
}, _Stanza_expandValue = function _Stanza_expandValue(value, slots, cursor) {
    // A comment and a processing instruction are the places in a template a
    // value cannot go, so it is refused rather than written.
    //
    // Not because a value could break out of one: a comment may not hold
    // `--` at all, so a value carrying the `-->` which would end it does
    // not parse, and the parser says so, and a value in a processing
    // instruction is escaped, so the `>` of a `?>` it carries is not one.
    // Because it goes nowhere. {@link prune} drops both, so the value in
    // one is dropped with it on the way to the wire, and no slot was
    // written to notice: a value there is character data rather than a
    // node to stand in for, so {@link assertFilled} has nothing to count.
    // Silent loss is the one thing this mechanism exists to prevent, and
    // these are the positions where it cannot be caught after the fact.
    if (cursor.mode === 'comment' || cursor.mode === 'pi') {
        const what = cursor.mode === 'comment' ? 'a comment' : 'a processing instruction';
        throw new Error(`A value cannot be interpolated into ${what}. Neither a comment nor a processing ` +
            'instruction is serialized, so the value would be dropped on the way to the wire ' +
            'without a word.');
    }
    // Inside a tag or a CDATA section there is no node to stand in for, so
    // the value is written into the text as it always was. What that text
    // has to look like differs: a CDATA section reads it as characters, an
    // attribute value as characters the parser would otherwise rewrite, the
    // rest of a tag as markup.
    if (cursor.mode === 'cdata') {
        // A section a value opened at document level is one the values
        // after it cannot close: each is written as characters, the `]]>`
        // meant to close it included, so the section runs on through the
        // rest of the template. Refusing beats the parser error which the
        // unclosed section would otherwise produce.
        //
        // Asked of the section and not of the depth, which the cursor does
        // not count inside an element a value opened. A section the template
        // wrote there is at depth zero too, and closes like any other.
        if (cursor.opened) {
            throw new Error('A value landed in a CDATA section which markup interpolated at document level ' +
                'opened. Inside it every value is written as characters, including a "]]>" ' +
                'meant to close it, so the section would run on through the rest of the ' +
                'template. Write the section in the template text rather than in a value.');
        }
        return emit(serializeIntoCdata(value), cursor);
    }
    // A quote is only ever open inside a tag, so this catches an attribute
    // value and nothing else.
    if (cursor.quote)
        return emit(serializeIntoAttribute(value), cursor);
    if (cursor.mode !== 'text')
        return emit(serializeValue(value), cursor);
    if (Array.isArray(value)) {
        return value.map((v) => __classPrivateFieldGet(_a, _a, "m", _Stanza_expandValue).call(_a, v, slots, cursor)).join('');
    }
    // A nested template is expanded into the same text, and what it expands
    // to is left exactly as the cursor read it.
    //
    // It used to be trimmed, which is where the two could part company: the
    // cursor scans every run as {@link emit} writes it, so cutting
    // characters off afterwards left it holding a state for text which was
    // no longer there. A nested template ending in a tag lost the space
    // between an element's name and the attribute the outer template went
    // on to write, and one ending in `/ ` left the cursor believing an
    // element was still open, which put the next value on the wrong side of
    // {@link Cursor.depth}.
    //
    // Nothing is lost by leaving it: whitespace at the ends of a nested
    // template is between tags like any other, so {@link strip} takes it if
    // it is formatting and keeps it if it is content, which is the same
    // judgement it makes everywhere else. The trim could not tell those
    // apart, and cut inside tags as readily as between them.
    if (value instanceof _a) {
        return __classPrivateFieldGet(value, _Stanza_instances, "m", _Stanza_expand).call(value, slots, cursor);
    }
    // At document level there is no element for a node to land in.
    // The value is the stanza itself rather than content inside one, so it is
    // written into the text and parsed as markup.
    //
    // What such a value opens is the one thing the cursor deliberately does
    // not count. A value here is allowed to span, so that a stanza may be
    // opened by one and closed by another; counting would leave the cursor
    // inside the element it opened, and the value which closes that element
    // again would be stood in for rather than written out. So the depth is
    // put back where the value found it.
    //
    // It is read, though, which is a different question and was once
    // skipped along with the counting. A comment or a CDATA section a value
    // opens here carries on into the rest of the template, and a value which
    // lands in one has to be refused or written as characters like any
    // other. Left unread, the cursor believed it was still in element
    // content, so such a value went out escaped as markup, or into a comment
    // and so nowhere at all, with no slot written for {@link assertFilled}
    // to miss.
    if (cursor.depth <= 0) {
        const depth = cursor.depth;
        const text = emit(serializeValue(value), cursor);
        cursor.depth = depth;
        // The cursor was in text when the value began, or it would not have
        // got this far, so a CDATA section it is in now is one the value
        // opened. (Widened because the compiler cannot see emit move it.)
        if (cursor.mode === 'cdata')
            cursor.opened = true;
        return text;
    }
    slots.push(value);
    return emit(`<?${cursor.slot} ${slots.length - 1}?>`, cursor);
};
/**
 * Tagged template literal function which generates {@link Stanza} objects
 *
 * @example
 *      const pres = stx`<presence type="${type}" xmlns="jabber:client"><show>${show}</show></presence>`
 *      connection.send(pres);
 *
 * @example
 *      const msg = stx`<message
 *          from='sender@example.org'
 *          id='hgn27af1'
 *          to='recipient@example.org'
 *          type='chat'>
 *          <body>Hello world</body>
 *      </message>`;
 *
 *      connection.send(msg);
 *
 * Templates may be indented freely. The whitespace written between their tags
 * is formatting and is removed. However, whitespace which arrives through a `${}`
 * value (and is not itself inside a template) is considered content and kept.
 *
 * So the rule to write by is that whitespace you want on the wire goes inside
 * the `${}`.
 *
 *      stx`<div xmlns="${XHTML}">${[link1, '\n', link2]}</div>`  // kept
 *      stx`<div xmlns="${XHTML}">${link1}
 *          ${link2}</div>`                                      // removed
 *
 * Which way the template's own indentation around a `${}` goes is decided by
 * what the value puts against it, not by how the value was written. Indentation
 * against text is part of that text and is kept; indentation against an element
 * separates elements and is formatting, so it is removed. A string and markup
 * which begins and ends in text therefore lay out alike:
 *
 *      stx`<c>
 *          ${'hello'}
 *      </c>`                     // <c> holds a line break, "hello", a line break
 *      stx`<c>
 *          ${unsafeXML('hello')}
 *      </c>`                     // the same
 *      stx`<c>
 *          ${unsafeXML('<p>hello</p>')}
 *      </c>`                     // <c> holds only the <p>
 *
 * Each end is read on its own, so markup which begins in text and ends in an
 * element keeps the indentation before it and loses the indentation after it.
 * Whitespace inside the value is its own either way and is never touched.
 *
 * Two things are exempt, because their whitespace is read rather than laid
 * out: an XHTML-IM `<body>`, the one in the XHTML namespace, where a run of
 * whitespace between two inline elements separates words, and any subtree
 * marked `xml:space="preserve"`. The latter is also how to keep whitespace in
 * a string passed to {@link Stanza.toElement}, where there is no `${}` to put
 * it in. Either may opt out again with `xml:space="default"`.
 *
 * A value interpolated at document level, where no element encloses it, is
 * the exception to all of the above. It is the stanza rather than content
 * within one, so it is considered markup like a template's and its whitespace
 * is stripped the same way:
 *
 *      const xhtml = `<title type="xhtml"><div xmlns="${XHTML}">
 *          <a href="${a}">@bob</a>\n<a href="${b}">link</a>
 *      </div></title>`;
 *
 *      stx`<message xmlns="jabber:client">${unsafeXML(xhtml)}</message>`
 *      // the line break between the two <a> elements is kept
 *
 *      stx`${unsafeXML(`<message xmlns="jabber:client">${xhtml}</message>`)}`
 *      // it is stripped, along with the template's own indentation
 *
 * The two are told apart by where the whitespace came from, and at document
 * level that is no longer knowable. `xml:space="preserve"` is the only handle
 * there, so mark the elements whose whitespace matters before passing the markup in.
 *
 * Whitespace between XHTML elements is fragile in general, since it collapses
 * to a single space when rendered and this library is not the only thing
 * which may drop it. The business rules of XEP-0071 recommend writing a line
 * break as `<br/>` and whitespace which carries meaning as the equivalent
 * number of no-break spaces, which survives regardless.
 */
function stx(strings, ...values) {
    return new Stanza(strings, values);
}

const Strophe = Object.assign(Object.assign(Object.assign({ VERSION: '6.0.0', get TIMEOUT() {
        return Bosh.getTimeoutMultplier();
    },
    set TIMEOUT(n) {
        Bosh.setTimeoutMultiplier(n);
    },
    get SECONDARY_TIMEOUT() {
        return Bosh.getSecondaryTimeoutMultplier();
    },
    set SECONDARY_TIMEOUT(n) {
        Bosh.setSecondaryTimeoutMultiplier(n);
    } }, utils$1), log), { Request,
    Bosh,
    Websocket,
    WorkerWebsocket,
    Connection,
    Handler,
    SASLAnonymous,
    SASLPlain,
    SASLSHA1,
    SASLSHA256,
    SASLSHA384,
    SASLSHA512,
    SASLOAuthBearer,
    SASLExternal,
    SASLXOAuth2,
    Stanza,
    StreamManagement,
    MemoryStorageBackend,
    SessionStorageBackend,
    Builder,
    ElementType,
    ErrorCondition, LogLevel: LOG_LEVELS, NS,
    SASLMechanism,
    Status,
    TimedHandler, XHTML: Object.assign(Object.assign({}, XHTML), { validTag: validTag, validCSS: validCSS, validAttribute: validAttribute }), serialize(elem) {
        return Builder.serialize(elem);
    },
    setLogLevel(level) {
        log.setLogLevel(level);
    },
    addNamespace(name, value) {
        Strophe.NS[name] = value;
    },
    addConnectionPlugin(name, ptype) {
        Connection.addConnectionPlugin(name, ptype);
    } });
globalThis.$build = $build;
globalThis.$iq = $iq;
globalThis.$msg = $msg;
globalThis.$pres = $pres;
globalThis.Strophe = Strophe;
globalThis.stx = stx;
const toStanza = Stanza.toElement;
globalThis.toStanza = Stanza.toElement;

export { $build, $iq, $msg, $pres, Builder, MemoryStorageBackend, Request, SessionStorageBackend, Stanza, StreamManagement, StreamManagementMirror, Strophe, stx, toStanza };
//# sourceMappingURL=strophe.esm.js.map
