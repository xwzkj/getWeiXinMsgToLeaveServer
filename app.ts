// @ts-ignore
import soundVolume from "node-sound-volume";
import { Window } from "node-screenshots";
import OpenAI from "openai";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import timezone from "dayjs/plugin/timezone.js";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";

import { writeFile } from "fs/promises";
import { mkdirSync, existsSync, readdirSync, readFileSync, statSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
dotenv.config()

const API_URL = process.env.API_URL ?? 'http://localhost:3000'
const API_KEY = process.env.API_KEY ?? '114514'
const MAX_AI_CALL_COUNT = parseInt(process.env.MAX_AI_CALL_COUNT ?? '50')
let aiCallCount = 0


const sv = new soundVolume(join(dirname(fileURLToPath(import.meta.url)), 'svcl.exe'))
const logDir = join(dirname(fileURLToPath(import.meta.url)), 'log')

if (!existsSync(logDir)) {
    mkdirSync(logDir)
}
console.log("截图日志保存路径：", logDir)


dayjs.extend(utc)
dayjs.extend(timezone)
dayjs.tz.setDefault("Asia/Shanghai")

const openai = new OpenAI(
    {
        apiKey: process.env.AI_API_KEY,
        baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    }
);

async function getWXSound() {
    let volumes = await sv.listSoundVolumes({
        type: "Application",
        direction: "Render",
    });
    for (let i = 0; i < volumes.length; i++) {
        if ((volumes[i].name.includes("Weixin") || volumes[i].name.includes("WeChat")) && volumes[i].deviceState === "Active") {
            return true
        }
        // if(volumes[i].name.includes("Weixin") ){
        //     console.log(volumes[i])
        // }
    }
    return false
}
async function captureWX() {
    let windows = Window.all()
    for (let window of windows) {
        if (window.appName() === "WeChat" || window.appName() === "Weixin") {
            return await window.captureImage()
        }
    }
    return null
}

function debounce(func: Function, delay: number) {
    let timer: any
    return (...args: any) => {
        clearTimeout(timer);
        timer = setTimeout(() => {
            func(...args)
        }, delay);
    };
}

const handleWXMsg = async () => {
    let WXImage = await captureWX()
    if (WXImage) {
        let WXImagePngBin = await WXImage.toPng()
        // 找最新的日志截图
        let sortedLogFiles = readdirSync(logDir).sort((a, b) => { // 按时间倒序
            return statSync(join(logDir, b)).mtimeMs - statSync(join(logDir, a)).mtimeMs
        })
        if (sortedLogFiles.length > 0) { // 如果存在历史截图
            let previousImage = PNG.sync.read(readFileSync(join(logDir, sortedLogFiles[0])))
            // 判断新截图和之前的截图有没有变化
            let diff = (WXImage.width !== previousImage.width || WXImage.height !== previousImage.height) ? 1 : 0
            if (!diff) {
                diff = pixelmatch(PNG.sync.read(WXImagePngBin).data, previousImage.data, undefined, WXImage.width, WXImage.height, { threshold: 0.1 })
                if (diff <= 10) {
                    diff = 0;
                }
            }
            if (!diff) {
                // console.log("消息截图未变化")
                return
            }
        }
        // 如果不一样，把新截图存到日志
        console.log("收到新消息")
        let logFileName = join(logDir, `${dayjs().format("YYYY-MM-DD HH：mm：ss")}.png`)
        console.log('消息截图：' + logFileName)
        await writeFile(logFileName, WXImagePngBin)
        // 检查是否超过最大调用次数
        if (aiCallCount >= MAX_AI_CALL_COUNT) {
            console.log("已调用AI最大次数，取消请求")
            return
        }
        aiCallCount++
        console.log(`本次运行，今日已调用AI${aiCallCount}次，最多${MAX_AI_CALL_COUNT}次`)

        // 调用AI
        let base64 = WXImagePngBin.toString('base64')
        try {
            await AIprocess(base64)
        } catch (err) {
            console.error(err)
            console.log("重试中")
            try {
                await AIprocess(base64)
            } catch (err) {
                console.error(err)
                console.log("重试仍失败")
            }

        }

    } else {
        console.error("截图失败")
    }
}

async function AIprocess(base64: string) {
    console.log("提取消息内容中：")
    let completion = await (openai.chat.completions as any).create({
        model: "qwen3.5-plus",
        stream: false,
        enable_thinking: false,
        messages: [
            {
                role: "user",
                content: [
                    { type: "image_url", image_url: { "url": `data:image/png;base64,${base64}` } },
                    { type: "text", text: `提取图中最后一条消息的内容，仔细核对每个字后再输出。数据将提供给程序使用，不要输出额外内容，否则程序将崩溃` },
                ]
            }],
    });
    console.log(completion.usage)
    let content1 = completion.choices[0].message.content
    if (!content1) {
        throw new Error("AI返回为空")
    }
    console.log('消息内容：', content1)
    if (!content1.includes("请") || !content1.includes("假")) {
        console.log("非请假消息")
        return
    }
    console.log("分析消息内容中：")
    completion = await (openai.chat.completions as any).create({
        model: "deepseek-v4-flash",
        stream: false,
        enable_thinking: true,
        thinking_budget: 500,
        messages: [
            {
                role: "user",
                content: [
                    { type: "text", text: content1 },
                    {
                        type: "text", text: `
你需要查明以下内容
1.判断是否为请假申请
2.提取请假者姓名
3.提取起始日期和结束日期
重要：
今天是${dayjs().format("YYYY-MM-DD")}
1.如果请假时间和返校时间是同一天，则返校时间为次日日期
2.如果不是同一天，则按照原日期输出
3.若未提及日期，则请假日期为今天，返校日期为明天
4.若今天已经在返校时间后或返校当天，则按照非请假信息输出

输出将被程序使用，如果输出格式不符合要求，会导致程序崩溃！
你只能输出纯文本，不支持markdown/latex等格式，务必严格按照以下格式输出：
若传入内容是有效的请假信息，则只能输出该格式的JSON，且不可用代码块包裹：
{"name":"姓名","start":"YYYY-MM-DD","end":"YYYY-MM-DD"}
如：
{"name":"张三","start":"2026-04-30","end":"2026-05-01"}
若不是有效的请假信息或者当前时间不在请假时间内，只能输出四个字：消息无效` },
                ]
            }],
    });
    console.log(completion.usage)
    let content2 = completion.choices[0].message.content
    if (content2 === "消息无效") {
        console.log("消息无效：")
        console.log(completion.choices[0].message.reasoning_content)
    } else {
        console.log("请假消息", content2)
        let data = JSON.parse(content2 ?? '')
        let res = await fetch(`${API_URL}/add`, {
            method: 'POST',
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${API_KEY}`,
            },
            body: JSON.stringify(data),
        })
        console.log(JSON.stringify(await res.json()))
    }
}
setInterval(() => {
    handleWXMsg()
}, 10000)

// 每天0点0分重置调用次数
setInterval(() => {
    if (dayjs().format("HH:mm") === "00:00" && dayjs().second() < 5) {
        aiCallCount = 0
    }
}, 1000)
// handleWXMsg()