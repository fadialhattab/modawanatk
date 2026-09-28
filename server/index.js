import 'dotenv/config';
import express from 'express';
import mongoose from 'mongoose';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import jwt from 'jsonwebtoken';
import {rateLimit} from 'express-rate-limit';
import {randomBytes,scrypt as scryptCallback,timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {authInput,postInput} from './validation.js';
const scrypt=promisify(scryptCallback),app=express(),production=process.env.NODE_ENV==='production';
if(!process.env.MONGODB_URI||!process.env.JWT_SECRET||process.env.JWT_SECRET.length<32){console.error('Set MONGODB_URI and JWT_SECRET (32+ characters) in .env.');process.exit(1)}
if(production&&!process.env.APP_ORIGIN){console.error('Set APP_ORIGIN to the exact public HTTPS origin.');process.exit(1)}
if(process.env.TRUST_PROXY==='1')app.set('trust proxy',1);
app.use(helmet());app.use(express.json({limit:'24kb'}));app.use(cookieParser());
app.use('/api',rateLimit({windowMs:15*60*1000,limit:300,standardHeaders:'draft-7',legacyHeaders:false,message:{message:'طلبات كثيرة. حاول لاحقًا.'}}));
app.use('/api',(req,res,next)=>{if(!['GET','HEAD','OPTIONS'].includes(req.method)){const origin=req.get('origin'),allowed=process.env.APP_ORIGIN||'http://localhost:5173';if(origin&&origin!==allowed)return res.status(403).json({message:'مصدر الطلب غير مسموح.'});if(req.get('sec-fetch-site')==='cross-site')return res.status(403).json({message:'مصدر الطلب غير مسموح.'})}next()});
const User=mongoose.model('User',new mongoose.Schema({name:{type:String,required:true,maxLength:60},email:{type:String,required:true,unique:true},passwordHash:{type:String,required:true,select:false}},{timestamps:true}));
const postSchema=new mongoose.Schema({title:{type:String,required:true,maxLength:120},body:{type:String,required:true,maxLength:5000},author:{type:mongoose.Schema.Types.ObjectId,ref:'User',required:true}},{timestamps:true});postSchema.index({createdAt:-1});const Post=mongoose.model('Post',postSchema);
const cookie={httpOnly:true,secure:production,sameSite:'lax',path:'/',maxAge:7*24*60*60*1000};
const publicUser=u=>({_id:u._id.toString(),name:u.name});
function session(res,user){res.cookie('session',jwt.sign({sub:user._id.toString()},process.env.JWT_SECRET,{expiresIn:'7d',algorithm:'HS256'}),cookie)}
async function identity(req,res,next){try{const token=req.cookies.session;if(token){const payload=jwt.verify(token,process.env.JWT_SECRET,{algorithms:['HS256']});req.user=await User.findById(payload.sub)}}catch{}next()}
app.use('/api',identity);
function required(req,res,next){if(!req.user)return res.status(401).json({message:'يرجى تسجيل الدخول.'});next()}
const authLimit=rateLimit({windowMs:15*60*1000,limit:20,standardHeaders:'draft-7',legacyHeaders:false,message:{message:'محاولات كثيرة. حاول بعد قليل.'}});
async function hashPassword(password){const salt=randomBytes(16).toString('hex');return salt+':'+(await scrypt(password,salt,64)).toString('hex')}
async function verifyPassword(password,hash){const [salt,key]=hash.split(':');const actual=await scrypt(password,salt,64);return timingSafeEqual(Buffer.from(key,'hex'),actual)}
app.get('/api/health',(req,res)=>res.json({ok:mongoose.connection.readyState===1}));
app.get('/api/auth/me',(req,res)=>res.json({user:req.user?publicUser(req.user):null}));
app.post('/api/auth/register',authLimit,async(req,res,next)=>{try{const {email,password,name}=authInput(req.body,true);const u=await User.create({email,name,passwordHash:await hashPassword(password)});session(res,u);res.status(201).json({user:publicUser(u)})}catch(e){next(e)}});
app.post('/api/auth/login',authLimit,async(req,res,next)=>{try{const {email,password}=authInput(req.body);const u=await User.findOne({email}).select('+passwordHash');if(!u||!await verifyPassword(password,u.passwordHash))return res.status(401).json({message:'البريد أو كلمة المرور غير صحيحة.'});session(res,u);res.json({user:publicUser(u)})}catch(e){next(e)}});
app.post('/api/auth/logout',(req,res)=>{res.clearCookie('session',{httpOnly:true,secure:production,sameSite:'lax',path:'/'});res.json({ok:true})});
app.get('/api/posts',async(req,res,next)=>{try{const page=Math.max(1,Math.min(10000,parseInt(req.query.page)||1));res.json(await Post.find().sort({createdAt:-1}).skip((page-1)*100).limit(100).populate('author','name').lean())}catch(e){next(e)}});
app.post('/api/posts',required,async(req,res,next)=>{try{const p=await Post.create({...postInput(req.body),author:req.user._id});await p.populate('author','name');res.status(201).json(p)}catch(e){next(e)}});
app.param('id',(req,res,next,id)=>{if(!mongoose.isValidObjectId(id))return res.status(400).json({message:'معرّف غير صالح.'});next()});
app.put('/api/posts/:id',required,async(req,res,next)=>{try{const p=await Post.findOneAndUpdate({_id:req.params.id,author:req.user._id},{$set:postInput(req.body)},{new:true,runValidators:true}).populate('author','name');if(!p)return res.status(404).json({message:'الخاطرة غير موجودة أو لا تملك صلاحية تعديلها.'});res.json(p)}catch(e){next(e)}});
app.delete('/api/posts/:id',required,async(req,res,next)=>{try{const p=await Post.findOneAndDelete({_id:req.params.id,author:req.user._id});if(!p)return res.status(404).json({message:'الخاطرة غير موجودة أو لا تملك صلاحية حذفها.'});res.json({ok:true})}catch(e){next(e)}});
app.use('/api',(req,res)=>res.status(404).json({message:'المسار غير موجود.'}));
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));app.use(express.static(path.join(root,'dist')));app.get('/{*path}',(req,res)=>res.sendFile(path.join(root,'dist/index.html')));
app.use((err,req,res,next)=>{if(err.code===11000)return res.status(409).json({message:'هذا البريد مسجّل بالفعل.'});if(err.type==='entity.too.large')return res.status(413).json({message:'الطلب أكبر من الحجم المسموح.'});if(err instanceof SyntaxError)return res.status(400).json({message:'بيانات غير صالحة.'});if(err.name==='ValidationError'||/يرجى|تحقق|العنوان/.test(err.message))return res.status(400).json({message:err.message});console.error('Request failed:',err.name);res.status(500).json({message:'تعذر إتمام الطلب. حاول مرة أخرى.'})});
try{await mongoose.connect(process.env.MONGODB_URI,{serverSelectionTimeoutMS:10000});await User.init();const server=app.listen(process.env.PORT||5000,()=>console.log('Khawatir server ready'));process.on('SIGTERM',()=>server.close(async()=>{await mongoose.disconnect();process.exit(0)}))}catch(e){console.error('MongoDB connection failed. Check URI, database user and Atlas IP access list.');process.exit(1)}
