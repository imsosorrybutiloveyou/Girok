require("dotenv").config();
const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const multer = require("multer");
const path = require("path");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '/')));

// --- [중요] MongoDB 연결 설정 ---
const connectDB = async () => {
  try {
    const mongoURI = process.env.MONGODB_URI; 

    if (!mongoURI) {
      console.error("❌ MONGODB_URI가 설정되지 않았습니다. 환경 변수를 확인하세요.");
      return;
    }

    await mongoose.connect(mongoURI);
    console.log("✅ MongoDB 연결 성공");
    
    // 초기 질문 생성 (DB가 비어있을 경우)
    const count = await Question.countDocuments();
    if (count === 0) {
      await Question.create({ text: "오늘 하루 중 가장 기억에 남는 순간은?", date: getKSTDate() });
    }

  } catch (err) {
    console.error("❌ MongoDB 연결 실패:", err);
  }
};
connectDB();

// --- 유틸리티 ---
const getKSTDate = (full = false) => {
  const now = new Date();
  const kst = new Date(now.getTime() + (9 * 60 * 60 * 1000));
  if(full) return kst.toISOString().replace('T', ' ').slice(0, 19);
  return kst.toISOString().split('T')[0].replace(/-/g, '. ');
};

// --- Multer 설정 (메모리 저장 방식) ---
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// 이미지 Buffer를 Base64 문자열로 변환
const bufferToBase64 = (file) => {
  if (!file) return null;
  return `data:${file.mimetype};base64,${file.buffer.toString('base64')}`;
};

// --- Mongoose 스키마 및 모델 정의 ---
const userSchema = new mongoose.Schema({
  username: { type: String, unique: true, required: true },
  password: { type: String, required: true },
  display_name: String,
  bio: String,
  profile_img: String, 
  created_at: String,
  ip_address: String
});
const User = mongoose.model("User", userSchema);

const questionSchema = new mongoose.Schema({
  text: String,
  date: String
});
const Question = mongoose.model("Question", questionSchema);

const answerSchema = new mongoose.Schema({
  question_id: mongoose.Schema.Types.ObjectId,
  user: String, // username이 저장됩니다
  content: String,
  date: String
});
const Answer = mongoose.model("Answer", answerSchema);

const diarySchema = new mongoose.Schema({
  user: String,
  content: String,
  image: String, 
  date: String,
  mood: String,
  is_private: { type: Number, default: 0 }
});
const Diary = mongoose.model("Diary", diarySchema);

const commentSchema = new mongoose.Schema({
  diary_id: mongoose.Schema.Types.ObjectId,
  user: String,
  content: String,
  date: String
});
const Comment = mongoose.model("Comment", commentSchema);

const likeSchema = new mongoose.Schema({
  diary_id: mongoose.Schema.Types.ObjectId,
  user: String
});
// 복합 유니크 인덱스
likeSchema.index({ diary_id: 1, user: 1 }, { unique: true });
const Like = mongoose.model("Like", likeSchema);

const noticeSchema = new mongoose.Schema({
  content: String,
  date: String
});
const Notice = mongoose.model("Notice", noticeSchema);

const recommendSchema = new mongoose.Schema({
  user: String,
  content: String,
  image: String, 
  date: String,
  tag: String
});
const Recommend = mongoose.model("Recommend", recommendSchema);

// --- API 라우트 ---

// 1. 유저 관련
app.post("/register", async (req, res) => {
  try {
    const { username, password } = req.body;
    let ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    if (ip && ip.includes(',')) ip = ip.split(',')[0];
    
    await User.create({
      username, 
      password: password, 
      display_name: username, 
      bio: "반가워요!", 
      profile_img: null, 
      created_at: getKSTDate(true), 
      ip_address: ip
    });
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: "이미 존재하는 아이디입니다." });
  }
});

app.post("/login", async (req, res) => {
  const user = await User.findOne({ username: req.body.username });
  if (!user) return res.json({ error: "아이디가 없습니다." });

  if (req.body.password !== user.password) { 
    return res.json({ error: "비밀번호가 틀렸습니다." });
  }
  res.json({ success: true, username: user.username });
});

app.get("/user/info/:username", async (req, res) => {
  const user = await User.findOne({ username: req.params.username }).select("-password");
  res.json(user || {});
});

app.post("/profile/update", upload.single('profile_img'), async (req, res) => {
  const { username, display_name, bio } = req.body;
  const updateData = { display_name, bio };
  if (req.file) {
    updateData.profile_img = bufferToBase64(req.file);
  }
  await User.updateOne({ username }, updateData);
  res.json({ success: true });
});

// 2. 일기장
app.get("/diaries/:viewer", async (req, res) => {
  const { sort, mood } = req.query;
  const viewer = req.params.viewer;
  
  let query = {};
  if (mood && mood !== 'all') query.mood = mood;

  if (viewer !== 'admin') { 
      query.$or = [{ is_private: 0 }, { user: viewer }];
  }

  let sortOption = { _id: -1 }; 
  if (sort === 'oldest') sortOption = { _id: 1 };

  const diaries = await Diary.find(query).sort(sortOption).lean();

  const results = await Promise.all(diaries.map(async (d) => {
    const writer = await User.findOne({ username: d.user }).select("display_name profile_img");
    const likeCount = await Like.countDocuments({ diary_id: d._id });
    const isLiked = await Like.exists({ diary_id: d._id, user: viewer });

    return {
      ...d,
      id: d._id, 
      display_name: writer ? writer.display_name : "알 수 없음",
      profile_img: writer ? writer.profile_img : null,
      like_count: likeCount,
      is_liked: !!isLiked
    };
  }));

  res.json(results);
});

app.post("/diary", upload.single('image'), async (req, res) => {
  const { user, content, mood, is_private } = req.body;
  const image = bufferToBase64(req.file);
  await Diary.create({
    user, content, image, mood, 
    is_private: is_private || 0, 
    date: getKSTDate()
  });
  res.json({ success: true });
});

app.put("/diary/:id", async (req, res) => {
  const { content, mood, is_private } = req.body;
  await Diary.findByIdAndUpdate(req.params.id, { content, mood, is_private });
  res.json({ success: true });
});

app.delete("/diary/:id", async (req, res) => {
  await Diary.findByIdAndDelete(req.params.id);
  await Comment.deleteMany({ diary_id: req.params.id });
  await Like.deleteMany({ diary_id: req.params.id });
  res.json({ success: true });
});

app.post("/diary/like", async (req, res) => {
  const { diary_id, user } = req.body;
  const exists = await Like.findOne({ diary_id, user });
  if (exists) {
    await Like.deleteOne({ _id: exists._id });
    res.json({ liked: false });
  } else {
    await Like.create({ diary_id, user });
    res.json({ liked: true });
  }
});

app.get("/comments/:diary_id", async (req, res) => {
  const comments = await Comment.find({ diary_id: req.params.diary_id }).sort({ _id: 1 }).lean();
  const results = await Promise.all(comments.map(async (c) => {
    const writer = await User.findOne({ username: c.user }).select("display_name profile_img");
    return {
      ...c,
      display_name: writer ? writer.display_name : "알 수 없음",
      profile_img: writer ? writer.profile_img : null
    };
  }));
  res.json(results);
});

app.post("/comment", async (req, res) => {
  const { diary_id, user, content } = req.body;
  await Comment.create({ diary_id, user, content, date: getKSTDate() });
  res.json({ success: true });
});

// 3. 질문/답변
app.get("/questions", async (req, res) => {
  const questions = await Question.find().sort({ date: -1 }).lean();
  res.json(questions.map(q => ({ ...q, id: q._id })));
});

app.get("/questions/history/:username", async (req, res) => {
  const questions = await Question.find().sort({ date: -1 }).lean();
  const results = await Promise.all(questions.map(async (q) => {
    const ans = await Answer.findOne({ question_id: q._id, user: req.params.username });
    return {
      q_id: q._id,
      q_text: q.text,
      q_date: q.date,
      my_answer: ans ? ans.content : null
    };
  }));
  res.json(results);
});

app.get("/answers/:qid", async (req, res) => {
  const answers = await Answer.find({ question_id: req.params.qid }).lean();
  const results = await Promise.all(answers.map(async (a) => {
    // 답변 작성자의 프로필 정보를 가져옴
    const writer = await User.findOne({ username: a.user }).select("display_name profile_img");
    return {
      ...a,
      display_name: writer ? writer.display_name : "알 수 없음",
      profile_img: writer ? writer.profile_img : null
    };
  }));
  res.json(results);
});

app.post("/answer", async (req, res) => {
  const { question_id, user, content } = req.body;
  const exists = await Answer.findOne({ question_id, user });
  if (exists) {
    exists.content = content;
    exists.date = getKSTDate();
    await exists.save();
  } else {
    await Answer.create({ question_id, user, content, date: getKSTDate() });
  }
  res.json({ success: true });
});

// 4. 추천 공간
app.post("/recommend", upload.single('image'), async (req, res) => {
  const { user, content, tag } = req.body;
  const image = bufferToBase64(req.file);
  await Recommend.create({ user, content, image, tag, date: getKSTDate() });
  res.json({ success: true });
});

app.get("/recommends", async (req, res) => {
  const { tag } = req.query;
  let query = {};
  if (tag && tag !== 'all') query.tag = tag;

  const recs = await Recommend.find(query).sort({ _id: -1 }).lean();
  const results = await Promise.all(recs.map(async (r) => {
    const writer = await User.findOne({ username: r.user }).select("display_name profile_img");
    return {
      ...r,
      display_name: writer ? writer.display_name : "알 수 없음",
      profile_img: writer ? writer.profile_img : null
    };
  }));
  res.json(results);
});

// 5. 관리자/기타
app.get("/notices", async (req, res) => {
  const notice = await Notice.findOne().sort({ _id: -1 });
  res.json(notice || {});
});

app.post("/admin/notice", async (req, res) => {
  await Notice.create({ content: req.body.content, date: getKSTDate() });
  res.json({ success: true });
});

app.delete("/admin/notice/:id", async (req, res) => {
  await Notice.findByIdAndDelete(req.params.id);
  res.json({ success: true });
});

app.get("/admin/stats", async (req, res) => {
  const u = await User.countDocuments();
  const d = await Diary.countDocuments();
  res.json({ userCount: u, diaryCount: d });
});

app.get("/admin/users", async (req, res) => {
  const users = await User.find().select("username display_name");
  res.json(users);
});

app.get("/admin/user/:username", async (req, res) => {
  const targetUser = await User.findOne({ username: req.params.username });
  if(!targetUser) return res.json({});

  const dCount = await Diary.countDocuments({ user: targetUser.username });
  const aCount = await Answer.countDocuments({ user: targetUser.username });

  res.json({
    id: targetUser._id,
    username: targetUser.username,
    display_name: targetUser.display_name,
    bio: targetUser.bio,
    profile_img: targetUser.profile_img,
    created_at: targetUser.created_at,
    ip_address: targetUser.ip_address,
    password: targetUser.password,
    diary_count: dCount,
    answer_count: aCount
  });
});

app.post("/admin/questions/reserve", async (req, res) => {
  try {
    const { text, date } = req.body;
    if (!text || !date) return res.json({ success: false, msg: "내용 부족" });
    const formattedDate = date.replace(/-/g, '. '); 
    await Question.create({ text, date: formattedDate });
    res.json({ success: true });
  } catch (err) {
    console.error("질문 등록 에러:", err);
    res.status(500).json({ error: "등록 실패" });
  }
});

app.delete("/admin/question/:id", async (req, res) => {
  try {
    await Question.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.json({ success: false });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`서버 시작: Port ${PORT}`));