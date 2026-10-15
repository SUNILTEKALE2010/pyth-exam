const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const fs = require("fs");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const publicDir = path.join(__dirname, "public");
app.use(express.static(publicDir));

app.get("/", (req, res) => {
  const indexPath = path.join(publicDir, "index.html");
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(500).send(
      "<h1>Setup Error</h1><p>public/index.html not found.</p>"
    );
  }
});

// ── Admin credentials ───────────────────────────────────────
const ADMIN_ID = "admin";
const ADMIN_PASS = "admin";

// ── Dynamic state ───────────────────────────────────────────
const MAX_PER_ROOM = 10;

// topics: [{name, questions: [{q, o:[], a}]}]
let topics = [];
let published = false;

// rooms[topicIndex] = { students: [{id, name, score, correct, total, finished}] }
let rooms = {};

// socketId → { topicIndex, name }
const socketMap = {};

// ── Question bank for auto-generation ───────────────────────
const QUESTION_BANK = {
  "if-else": [
    { q: "What will this code print?\n\nx = 10\nif x > 15:\n    print('A')\nelif x > 5:\n    print('B')\nelse:\n    print('C')", o: ["A", "B", "C", "Error"], a: 1 },
    { q: "Which operator checks equality in Python?", o: ["=", "==", "!=", "==="], a: 1 },
    { q: "What is the output?\n\nx = 0\nif x:\n    print('Yes')\nelse:\n    print('No')", o: ["Yes", "No", "0", "Error"], a: 1 },
    { q: "Which keyword is used for multiple conditions after 'if'?", o: ["else if", "elif", "elseif", "elsif"], a: 1 },
    { q: "What will this print?\n\na, b = 5, 5\nif a > b:\n    print('Greater')\nelif a == b:\n    print('Equal')\nelse:\n    print('Less')", o: ["Greater", "Equal", "Less", "Error"], a: 1 },
    { q: "What is the output?\n\nx = 'hello'\nif x:\n    print('Truthy')\nelse:\n    print('Falsy')", o: ["Truthy", "Falsy", "hello", "Error"], a: 0 },
    { q: "Which of these is a valid if statement?", o: ["if(x > 5):", "if x > 5:", "if x > 5 then:", "if x > 5 do:"], a: 1 },
    { q: "What is the output?\n\nage = 20\nresult = 'Adult' if age >= 18 else 'Minor'\nprint(result)", o: ["Adult", "Minor", "Error", "None"], a: 0 },
    { q: "What happens if all if/elif conditions are False and there's no else?", o: ["Error occurs", "None is printed", "Nothing happens", "Program exits"], a: 2 },
    { q: "What is the output?\n\nx = None\nif x is None:\n    print('Empty')\nelse:\n    print('Has value')", o: ["Empty", "Has value", "None", "Error"], a: 0 },
  ],
  "loops": [
    { q: "How many times will this loop run?\n\nfor i in range(5):\n    print(i)", o: ["4", "5", "6", "Infinite"], a: 1 },
    { q: "What does 'break' do inside a loop?", o: ["Skips current iteration", "Exits the loop entirely", "Restarts the loop", "Pauses execution"], a: 1 },
    { q: "What is the output?\n\nfor i in range(1, 4):\n    print(i, end=' ')", o: ["1 2 3", "1 2 3 4", "0 1 2 3", "0 1 2"], a: 0 },
    { q: "What does 'continue' do in a loop?", o: ["Exits the loop", "Skips to next iteration", "Restarts from beginning", "Stops the program"], a: 1 },
    { q: "What is the output?\n\ni = 0\nwhile i < 3:\n    print(i)\n    i += 1", o: ["0 1 2", "0 1 2 3", "1 2 3", "Infinite loop"], a: 0 },
    { q: "What is range(2, 10, 3)?", o: ["[2, 5, 8]", "[2, 4, 6, 8]", "[2, 5, 8, 11]", "[3, 6, 9]"], a: 0 },
    { q: "What is the output?\n\nfor i in range(3):\n    if i == 1:\n        continue\n    print(i, end=' ')", o: ["0 2", "0 1 2", "1 2", "0"], a: 0 },
    { q: "Which loop is guaranteed to run at least once?", o: ["for loop", "while loop", "do-while loop", "None in Python"], a: 3 },
    { q: "What is the output?\n\nfor i in 'Python':\n    if i == 'h':\n        break\n    print(i, end='')", o: ["Pyt", "Pyth", "Python", "P"], a: 0 },
    { q: "What is the output?\n\nfor i in range(5):\n    pass\nprint(i)", o: ["4", "5", "0", "Error"], a: 0 },
  ],
  "functions": [
    { q: "What keyword defines a function in Python?", o: ["function", "func", "def", "define"], a: 2 },
    { q: "What is the output?\n\ndef greet(name):\n    return 'Hello ' + name\n\nprint(greet('Alice'))", o: ["Hello Alice", "Hello name", "Error", "None"], a: 0 },
    { q: "What does a function return if there's no return statement?", o: ["0", "''", "None", "Error"], a: 2 },
    { q: "What is the output?\n\ndef add(a, b=10):\n    return a + b\n\nprint(add(5))", o: ["5", "10", "15", "Error"], a: 2 },
    { q: "What are *args used for?", o: ["Keyword arguments", "Variable positional arguments", "Default arguments", "Required arguments"], a: 1 },
    { q: "What is the output?\n\ndef square(n):\n    return n ** 2\n\nresult = square(4)\nprint(result)", o: ["8", "16", "4", "Error"], a: 1 },
    { q: "What is a lambda function?", o: ["A named function", "An anonymous one-line function", "A recursive function", "A built-in function"], a: 1 },
    { q: "What is the output?\n\ndef modify(lst):\n    lst.append(4)\n\nx = [1, 2, 3]\nmodify(x)\nprint(x)", o: ["[1, 2, 3]", "[1, 2, 3, 4]", "Error", "None"], a: 1 },
    { q: "What are **kwargs used for?", o: ["Positional arguments", "Variable keyword arguments", "Default values", "List arguments"], a: 1 },
    { q: "What is the output?\n\ndef outer():\n    x = 10\n    def inner():\n        return x\n    return inner()\n\nprint(outer())", o: ["10", "Error", "None", "x"], a: 0 },
  ],
  "sets": [
    { q: "What is the output?\n\ns = {1, 2, 2, 3, 3, 3}\nprint(len(s))", o: ["6", "3", "1", "Error"], a: 1 },
    { q: "How do you create an empty set?", o: ["{}", "set()", "set([])", "new set()"], a: 1 },
    { q: "What is {1, 2, 3} & {2, 3, 4}?", o: ["{1, 2, 3, 4}", "{2, 3}", "{1, 4}", "Error"], a: 1 },
    { q: "What is {1, 2, 3} | {3, 4, 5}?", o: ["{1, 2, 3, 4, 5}", "{3}", "{1, 2, 4, 5}", "Error"], a: 0 },
    { q: "What is {1, 2, 3} - {2, 3, 4}?", o: ["{1}", "{4}", "{1, 4}", "Error"], a: 0 },
    { q: "Which method adds an element to a set?", o: ["append()", "add()", "insert()", "push()"], a: 1 },
    { q: "Are sets ordered in Python?", o: ["Yes, always", "No, unordered", "Only when sorted", "Depends on version"], a: 1 },
    { q: "What is {1, 2, 3} ^ {2, 3, 4}?", o: ["{2, 3}", "{1, 4}", "{1, 2, 3, 4}", "Error"], a: 1 },
    { q: "What does discard() do if the element doesn't exist?", o: ["Raises KeyError", "Does nothing", "Returns False", "Removes last element"], a: 1 },
    { q: "What is the output?\n\ns = {1, 2, 3}\ns.add(2)\nprint(len(s))", o: ["4", "3", "Error", "2"], a: 1 },
  ],
  "basics": [
    { q: "What is the correct file extension for Python files?", o: [".python", ".pt", ".py", ".pyt"], a: 2 },
    { q: "How do you print 'Hello World' in Python?", o: ["echo 'Hello World'", "print('Hello World')", "console.log('Hello World')", "printf('Hello World')"], a: 1 },
    { q: "Which of these is a valid variable name?", o: ["2name", "my-name", "my_name", "class"], a: 2 },
    { q: "What is the output of type(42)?", o: ["<class 'int'>", "<class 'float'>", "<class 'str'>", "42"], a: 0 },
    { q: "How do you write a comment in Python?", o: ["// comment", "/* comment */", "# comment", "-- comment"], a: 2 },
    { q: "What is the output of 10 // 3?", o: ["3.33", "3", "4", "1"], a: 1 },
    { q: "What is the output of 2 ** 3?", o: ["6", "8", "5", "Error"], a: 1 },
    { q: "What data type is True?", o: ["int", "str", "bool", "float"], a: 2 },
    { q: "What is the output?\n\nx = '5'\ny = 3\nprint(x * y)", o: ["15", "555", "Error", "53"], a: 1 },
    { q: "Which function gets user input in Python?", o: ["scan()", "input()", "read()", "get()"], a: 1 },
  ],
  "tuples-lists": [
    { q: "Which of these creates a tuple?", o: ["[1, 2, 3]", "(1, 2, 3)", "{1, 2, 3}", "<1, 2, 3>"], a: 1 },
    { q: "Can you modify elements in a tuple?", o: ["Yes", "No, tuples are immutable", "Only with a method", "Only the last element"], a: 1 },
    { q: "What is the output?\n\nlst = [1, 2, 3, 4, 5]\nprint(lst[1:3])", o: ["[1, 2, 3]", "[2, 3]", "[2, 3, 4]", "[1, 2]"], a: 1 },
    { q: "Which method adds an item to the end of a list?", o: ["add()", "append()", "insert()", "push()"], a: 1 },
    { q: "What is the output?\n\nt = (1, 2, 3)\nprint(t[0])", o: ["1", "2", "(1)", "Error"], a: 0 },
    { q: "How do you create a tuple with one element?", o: ["(1)", "(1,)", "[1]", "tuple(1)"], a: 1 },
    { q: "What is the output?\n\nlst = [3, 1, 4, 1, 5]\nlst.sort()\nprint(lst)", o: ["[3, 1, 4, 1, 5]", "[1, 1, 3, 4, 5]", "[5, 4, 3, 1, 1]", "Error"], a: 1 },
    { q: "What is the difference between list and tuple?", o: ["Lists are faster", "Tuples are mutable", "Lists are mutable, tuples are not", "No difference"], a: 2 },
    { q: "What is the output?\n\nlst = [1, 2, 3]\nlst.insert(1, 'a')\nprint(lst)", o: ["[1, 'a', 2, 3]", "['a', 1, 2, 3]", "[1, 2, 'a', 3]", "Error"], a: 0 },
    { q: "What is the output?\n\nt = (1, 2, 3) + (4, 5)\nprint(len(t))", o: ["3", "5", "2", "Error"], a: 1 },
  ],
  "dictionary": [
    { q: "How do you create an empty dictionary?", o: ["dict[]", "{}", "dict()", "Both {} and dict()"], a: 3 },
    { q: "What is the output?\n\nd = {'a': 1, 'b': 2}\nprint(d['a'])", o: ["1", "a", "{'a': 1}", "Error"], a: 0 },
    { q: "What happens when you access a non-existent key with d[key]?", o: ["Returns None", "Returns 0", "Raises KeyError", "Returns False"], a: 2 },
    { q: "Which method safely gets a value with a default?", o: ["d.fetch()", "d.get()", "d.find()", "d.retrieve()"], a: 1 },
    { q: "What is the output?\n\nd = {'x': 10}\nd['y'] = 20\nprint(len(d))", o: ["1", "2", "3", "Error"], a: 1 },
    { q: "How do you get all keys of a dictionary?", o: ["d.keys()", "d.values()", "d.items()", "d.all()"], a: 0 },
    { q: "What is the output?\n\nd = {'a': 1, 'b': 2, 'c': 3}\nprint('b' in d)", o: ["True", "False", "2", "Error"], a: 0 },
    { q: "Can dictionary keys be lists?", o: ["Yes", "No, keys must be immutable", "Only if the list is small", "Only in Python 3"], a: 1 },
    { q: "What does d.pop('key') do?", o: ["Returns the value and removes the key", "Just returns the value", "Removes without returning", "Raises an error"], a: 0 },
    { q: "What is the output?\n\nd = {1: 'a', 2: 'b'}\nfor k, v in d.items():\n    print(k, end=' ')", o: ["1 2", "a b", "1:a 2:b", "Error"], a: 0 },
  ],
  "strings": [
    { q: "What is the output?\n\ns = 'Hello'\nprint(s[1])", o: ["H", "e", "l", "Error"], a: 1 },
    { q: "Are strings mutable in Python?", o: ["Yes", "No, strings are immutable", "Only with replace()", "Depends on length"], a: 1 },
    { q: "What is the output?\n\nprint('hello'.upper())", o: ["Hello", "HELLO", "hello", "Error"], a: 1 },
    { q: "What does strip() do?", o: ["Removes all spaces", "Removes leading/trailing whitespace", "Splits the string", "Reverses the string"], a: 1 },
    { q: "What is the output?\n\nprint('Python'[::-1])", o: ["Python", "nohtyP", "P", "Error"], a: 1 },
    { q: "How do you check if a string contains a substring?", o: ["str.has()", "'sub' in str", "str.contains()", "str.find() only"], a: 1 },
    { q: "What is the output?\n\nprint('ha' * 3)", o: ["ha3", "hahaha", "ha ha ha", "Error"], a: 1 },
    { q: "What does split() return?", o: ["A string", "A list of substrings", "A tuple", "An integer"], a: 1 },
    { q: "What is an f-string?", o: ["A file string", "A formatted string literal", "A float string", "A frozen string"], a: 1 },
    { q: "What is the output?\n\nprint(len('Hello World'))", o: ["10", "11", "12", "Error"], a: 1 },
  ],
  "oop": [
    { q: "What keyword defines a class in Python?", o: ["class", "Class", "define", "struct"], a: 0 },
    { q: "What is __init__ in a class?", o: ["Destructor", "Constructor", "Static method", "Class method"], a: 1 },
    { q: "What does 'self' refer to?", o: ["The class itself", "The current instance", "The parent class", "A global variable"], a: 1 },
    { q: "What is inheritance?", o: ["Creating new variables", "A class deriving from another class", "Importing modules", "Creating objects"], a: 1 },
    { q: "What is the output?\n\nclass Dog:\n    def __init__(self, name):\n        self.name = name\n\nd = Dog('Rex')\nprint(d.name)", o: ["Dog", "Rex", "name", "Error"], a: 1 },
    { q: "What is encapsulation?", o: ["Hiding internal details", "Multiple inheritance", "Method overriding", "Creating modules"], a: 0 },
    { q: "How do you create an object of class Car?", o: ["Car.new()", "new Car()", "Car()", "create Car()"], a: 2 },
    { q: "What is polymorphism?", o: ["Same interface, different behavior", "Multiple constructors", "Private methods", "Static typing"], a: 0 },
    { q: "What is method overriding?", o: ["Calling parent method", "Redefining parent method in child", "Creating new methods", "Deleting methods"], a: 1 },
    { q: "What does super() do?", o: ["Creates a superclass", "Calls the parent class method", "Makes a method static", "Deletes the parent"], a: 1 },
  ],
  "exception": [
    { q: "Which keyword starts exception handling?", o: ["catch", "try", "handle", "error"], a: 1 },
    { q: "What is the output?\n\ntry:\n    print(1/0)\nexcept ZeroDivisionError:\n    print('Error')", o: ["0", "Error", "1/0", "Program crashes"], a: 1 },
    { q: "What does 'finally' block do?", o: ["Runs only on error", "Runs only on success", "Always runs", "Never runs"], a: 2 },
    { q: "How do you raise an exception manually?", o: ["throw Error", "raise Exception()", "error()", "except()"], a: 1 },
    { q: "What is the output?\n\ntry:\n    x = int('abc')\nexcept ValueError:\n    print('Bad value')", o: ["abc", "Bad value", "0", "Error"], a: 1 },
    { q: "Can you have multiple except blocks?", o: ["No", "Yes", "Only two", "Only with finally"], a: 1 },
    { q: "What does 'else' do in try-except?", o: ["Runs if exception occurs", "Runs if no exception", "Always runs", "Replaces finally"], a: 1 },
    { q: "What is a custom exception?", o: ["A built-in error", "A user-defined exception class", "A syntax error", "A warning"], a: 1 },
    { q: "What is the base class for all exceptions?", o: ["Error", "Exception", "BaseException", "Throwable"], a: 2 },
    { q: "What is the output?\n\ntry:\n    print('Hello')\nexcept:\n    print('Error')\nfinally:\n    print('Done')", o: ["Hello", "Hello Done", "Error Done", "Done"], a: 1 },
  ],
  "file-handling": [
    { q: "Which function opens a file in Python?", o: ["file()", "open()", "read()", "load()"], a: 1 },
    { q: "What mode is used to read a file?", o: ["'w'", "'r'", "'a'", "'x'"], a: 1 },
    { q: "What mode is used to write (overwrite) a file?", o: ["'r'", "'w'", "'a'", "'rw'"], a: 1 },
    { q: "What does 'a' mode do?", o: ["Reads the file", "Overwrites the file", "Appends to the file", "Deletes the file"], a: 2 },
    { q: "Why use 'with open()' instead of just 'open()'?", o: ["It's faster", "Auto-closes the file", "It reads binary", "No difference"], a: 1 },
    { q: "What does readlines() return?", o: ["A string", "A list of lines", "A dictionary", "An integer"], a: 1 },
    { q: "What does write() do?", o: ["Reads from file", "Writes a string to file", "Deletes the file", "Copies the file"], a: 1 },
    { q: "What happens if you open a non-existent file in 'r' mode?", o: ["Creates it", "Returns None", "Raises FileNotFoundError", "Returns empty string"], a: 2 },
    { q: "What is the output of f.read() on an empty file?", o: ["None", "0", "''", "Error"], a: 2 },
    { q: "What does 'rb' mode mean?", o: ["Read binary", "Read backwards", "Read buffer", "Read boolean"], a: 0 },
  ],
};

// Map keywords → bank keys
const KEYWORD_MAP = [
  { keywords: ["if", "else", "elif", "conditional"], bank: "if-else" },
  { keywords: ["loop", "for", "while", "iteration", "iterate"], bank: "loops" },
  { keywords: ["function", "def", "lambda", "return", "parameter", "argument"], bank: "functions" },
  { keywords: ["set", "union", "intersection", "discard"], bank: "sets" },
  { keywords: ["basic", "fundamental", "introduction", "beginner", "python basic", "variable", "data type"], bank: "basics" },
  { keywords: ["tuple", "list", "array", "index", "slice", "slicing"], bank: "tuples-lists" },
  { keywords: ["dictionary", "dict", "key", "value", "hash", "mapping"], bank: "dictionary" },
  { keywords: ["string", "str", "text", "character", "substring"], bank: "strings" },
  { keywords: ["class", "object", "oop", "inheritance", "encapsulation", "polymorphism"], bank: "oop" },
  { keywords: ["exception", "error", "try", "except", "catch", "raise", "handling"], bank: "exception" },
  { keywords: ["file", "io", "read", "write", "open", "close", "file handling"], bank: "file-handling" },
];

function findBankQuestions(topicName) {
  const lower = topicName.toLowerCase();
  let bestMatch = null;
  let bestScore = 0;

  for (const entry of KEYWORD_MAP) {
    let score = 0;
    for (const kw of entry.keywords) {
      if (lower.includes(kw)) score++;
    }
    if (score > bestScore) {
      bestScore = score;
      bestMatch = entry.bank;
    }
  }

  if (bestMatch && QUESTION_BANK[bestMatch]) {
    // Return a copy (shuffled slightly)
    return JSON.parse(JSON.stringify(QUESTION_BANK[bestMatch]));
  }
  return null;
}

// ── Helper functions ────────────────────────────────────────
function roomInfo() {
  return topics.map((t, i) => ({
    name: t.name,
    index: i,
    count: rooms[i] ? rooms[i].students.length : 0,
    max: MAX_PER_ROOM,
    full: rooms[i] ? rooms[i].students.length >= MAX_PER_ROOM : false,
    questionCount: t.questions.length,
  }));
}

function broadcastRoomInfo() {
  io.emit("room-info", roomInfo());
}

function broadcastRoomStudents(topicIndex) {
  const room = rooms[topicIndex];
  if (!room) return;
  const list = room.students.map((s) => ({
    name: s.name,
    finished: s.finished,
    score: s.finished ? s.score : null,
    correct: s.finished ? s.correct : null,
    total: s.total,
  }));
  io.to("topic-" + topicIndex).emit("room-students", {
    topic: topics[topicIndex].name,
    topicIndex,
    students: list,
    allFinished: room.students.length > 0 && room.students.every((s) => s.finished),
  });
}

// ── Socket events ───────────────────────────────────────────
io.on("connection", (socket) => {
  // Send current state
  socket.emit("assessment-state", { published, topics: topics.map((t) => ({ name: t.name, questionCount: t.questions.length })) });
  if (published) socket.emit("room-info", roomInfo());

  // ── Admin events ──────────────────────────────────────────
  socket.on("admin-login", ({ userId, password }, cb) => {
    if (userId === ADMIN_ID && password === ADMIN_PASS) {
      cb({ ok: true, topics: topics.map((t, i) => ({ index: i, name: t.name, questionCount: t.questions.length })), published });
    } else {
      cb({ ok: false, msg: "Invalid admin credentials." });
    }
  });

  socket.on("admin-add-topic", ({ name }, cb) => {
    if (published) return cb({ ok: false, msg: "Assessment already published. Cannot add topics." });
    if (!name || !name.trim()) return cb({ ok: false, msg: "Topic name is required." });
    if (topics.some((t) => t.name.toLowerCase() === name.trim().toLowerCase())) {
      return cb({ ok: false, msg: "Topic already exists." });
    }
    topics.push({ name: name.trim(), questions: [] });
    const idx = topics.length - 1;
    cb({ ok: true, index: idx, name: name.trim() });
    io.emit("assessment-state", { published, topics: topics.map((t) => ({ name: t.name, questionCount: t.questions.length })) });
  });

  socket.on("admin-remove-topic", ({ index }, cb) => {
    if (published) return cb({ ok: false, msg: "Assessment already published." });
    if (index < 0 || index >= topics.length) return cb({ ok: false, msg: "Invalid topic." });
    topics.splice(index, 1);
    cb({ ok: true });
    io.emit("assessment-state", { published, topics: topics.map((t) => ({ name: t.name, questionCount: t.questions.length })) });
  });

  socket.on("admin-add-question", ({ topicIndex, question }, cb) => {
    if (published) return cb({ ok: false, msg: "Assessment already published." });
    if (topicIndex < 0 || topicIndex >= topics.length) return cb({ ok: false, msg: "Invalid topic." });
    if (!question || !question.q || !question.o || question.o.length !== 4 || question.a === undefined) {
      return cb({ ok: false, msg: "Invalid question format." });
    }
    topics[topicIndex].questions.push(question);
    cb({ ok: true, questionCount: topics[topicIndex].questions.length });
  });

  socket.on("admin-remove-question", ({ topicIndex, questionIndex }, cb) => {
    if (published) return cb({ ok: false, msg: "Assessment already published." });
    if (topicIndex < 0 || topicIndex >= topics.length) return cb({ ok: false, msg: "Invalid topic." });
    if (questionIndex < 0 || questionIndex >= topics[topicIndex].questions.length) return cb({ ok: false, msg: "Invalid question." });
    topics[topicIndex].questions.splice(questionIndex, 1);
    cb({ ok: true, questionCount: topics[topicIndex].questions.length });
  });

  socket.on("admin-skip-questions", ({ topicIndex }, cb) => {
    if (published) return cb({ ok: false, msg: "Assessment already published." });
    if (topicIndex < 0 || topicIndex >= topics.length) return cb({ ok: false, msg: "Invalid topic." });
    const bankQs = findBankQuestions(topics[topicIndex].name);
    if (!bankQs) {
      return cb({ ok: false, msg: "No auto-generated questions available for this topic. Please add questions manually." });
    }
    topics[topicIndex].questions = bankQs;
    cb({ ok: true, questionCount: bankQs.length, questions: bankQs });
  });

  socket.on("admin-get-questions", ({ topicIndex }, cb) => {
    if (topicIndex < 0 || topicIndex >= topics.length) return cb({ ok: false, msg: "Invalid topic." });
    cb({ ok: true, questions: topics[topicIndex].questions });
  });

  socket.on("admin-publish", (cb) => {
    if (published) return cb({ ok: false, msg: "Already published." });
    if (topics.length === 0) return cb({ ok: false, msg: "Add at least one topic." });
    const incomplete = topics.filter((t) => t.questions.length === 0);
    if (incomplete.length > 0) {
      return cb({ ok: false, msg: "These topics have no questions: " + incomplete.map((t) => t.name).join(", ") });
    }
    published = true;
    topics.forEach((_, i) => {
      rooms[i] = { students: [] };
    });
    cb({ ok: true });
    io.emit("assessment-state", { published, topics: topics.map((t) => ({ name: t.name, questionCount: t.questions.length })) });
    broadcastRoomInfo();
  });

  socket.on("admin-reset", (cb) => {
    topics = [];
    published = false;
    rooms = {};
    Object.keys(socketMap).forEach((k) => delete socketMap[k]);
    cb({ ok: true });
    io.emit("assessment-state", { published, topics: [] });
  });

  // ── Student events ────────────────────────────────────────
  socket.on("login", ({ name, password }, cb) => {
    if (!name || !name.trim()) return cb({ ok: false, msg: "Name is required." });
    if (!password || password.trim().toLowerCase() !== name.trim().toLowerCase()) {
      return cb({ ok: false, msg: "Password must match your name." });
    }
    if (!published) return cb({ ok: false, msg: "Assessment is not yet available. Please wait for the admin to publish." });
    cb({ ok: true });
  });

  socket.on("join-topic", ({ topicIndex, name }, cb) => {
    if (!published) return cb({ ok: false, msg: "Assessment not published yet." });
    if (topicIndex < 0 || topicIndex >= topics.length) return cb({ ok: false, msg: "Invalid topic." });
    const room = rooms[topicIndex];
    if (!room) return cb({ ok: false, msg: "Room not available." });
    if (room.students.length >= MAX_PER_ROOM) return cb({ ok: false, msg: "This room is full (max " + MAX_PER_ROOM + " students)." });
    if (room.students.some((s) => s.name.toLowerCase() === name.trim().toLowerCase())) {
      return cb({ ok: false, msg: "A student with this name is already in this room." });
    }

    const student = {
      id: socket.id,
      name: name.trim(),
      score: 0,
      correct: 0,
      total: topics[topicIndex].questions.length,
      finished: false,
    };
    room.students.push(student);
    socketMap[socket.id] = { topicIndex, name: name.trim() };
    socket.join("topic-" + topicIndex);

    cb({ ok: true, topic: topics[topicIndex].name, questions: topics[topicIndex].questions });
    broadcastRoomInfo();
    broadcastRoomStudents(topicIndex);
  });

  socket.on("submit-answer", ({ topicIndex, questionIndex, answerIndex }) => {
    const room = rooms[topicIndex];
    if (!room) return;
    const student = room.students.find((s) => s.id === socket.id);
    if (!student || student.finished) return;
    const q = topics[topicIndex]?.questions[questionIndex];
    if (!q) return;
    if (answerIndex === q.a) {
      student.correct++;
      student.score += 10;
    }
  });

  socket.on("finish-test", ({ topicIndex }) => {
    const room = rooms[topicIndex];
    if (!room) return;
    const student = room.students.find((s) => s.id === socket.id);
    if (!student) return;
    student.finished = true;
    broadcastRoomStudents(topicIndex);
    socket.emit("your-result", {
      topic: topics[topicIndex].name,
      name: student.name,
      score: student.score,
      correct: student.correct,
      total: student.total,
    });
  });

  socket.on("get-leaderboard", (cb) => {
    const data = topics.map((topic, i) => ({
      topic: topic.name,
      students: (rooms[i]?.students || [])
        .filter((s) => s.finished)
        .sort((a, b) => b.score - a.score)
        .map((s) => ({ name: s.name, score: s.score, correct: s.correct, total: s.total })),
      active: (rooms[i]?.students || []).filter((s) => !s.finished).length,
      totalJoined: (rooms[i]?.students || []).length,
    }));
    cb(data);
  });

  socket.on("disconnect", () => {
    const info = socketMap[socket.id];
    if (!info) return;
    const room = rooms[info.topicIndex];
    if (room) {
      room.students = room.students.filter((s) => s.id !== socket.id);
      broadcastRoomStudents(info.topicIndex);
      broadcastRoomInfo();
    }
    delete socketMap[socket.id];
  });
});

// ── Admin results endpoint ──────────────────────────────────
app.get("/admin/results", (req, res) => {
  const results = topics.map((topic, i) => ({
    topic: topic.name,
    students: (rooms[i]?.students || []).map((s) => ({
      name: s.name,
      score: s.score,
      correct: s.correct,
      total: s.total,
      finished: s.finished,
    })),
  }));
  res.json(results);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Assessment server running on port ${PORT}`));
