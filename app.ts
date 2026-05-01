// @ts-ignore
import soundVolume from "node-sound-volume";
import { Window } from "node-screenshots";
import OpenAI from "openai";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import timezone from "dayjs/plugin/timezone.js";

import { readFile, writeFile } from "fs/promises";
import { mkdirSync, existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

import dotenv from 'dotenv'
dotenv.config()

const sv = new soundVolume('svcl.exe')
const logDir = join(dirname(fileURLToPath(import.meta.url)), 'log')
const dataFileName = join(dirname(fileURLToPath(import.meta.url)), 'data.json')
if (!existsSync(logDir)) {
    mkdirSync(logDir)
}
if (!existsSync(dataFileName)) {
    writeFile(dataFileName, '[]')
}
console.log("截图日志保存路径：", logDir)


dayjs.extend(utc)
dayjs.extend(timezone)
dayjs.tz.setDefault("Asia/Shanghai")

const openai = new OpenAI(
    {
        apiKey: process.env.API_KEY || '',
        baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    }
);

async function getWXSound() {
    let volumes = await sv.listSoundVolumes({
        type: "Application",
        direction: "Render",
    });
    for (let i = 0; i < volumes.length; i++) {
        if (volumes[i].name.includes("WeChat") && volumes[i].deviceState === "Active") {
            return true
        }
    }
    return false
}
async function captureWX() {
    let windows = Window.all()
    for (let window of windows) {
        if (window.appName() === "WeChat") {
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

const handleWXMsg = debounce(async () => {
    console.log("收到新消息")
    let WXImage = await captureWX()
    if (WXImage) {
        let WXImagePng = await WXImage.toPng()
        await writeFile(join(logDir, `${dayjs().format("YYYY-MM-DD HH：mm：ss")}.png`), WXImagePng)
        let base64 = WXImagePng.toString('base64')
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

    }
}, 1000)

async function AIprocess(base64: string) {
    const completion = await (openai.chat.completions as any).create({
        model: "qwen3.5-plus",
        stream: false,
        enable_thinking: true,
        thinking_budget: 250,
        messages: [
            {
                role: "user",
                content: [
                    { type: "image_url", image_url: { "url": `data:image/png;base64,${base64}` } },
                    {
                        type: "text", text: `
图片是微信截图，你只能从最后一条消息获取信息，不能看之前的信息。
你需要查明以下内容
1.是否为请假申请
2.请假者姓名是什么
3.请假时间是哪天到哪天
重要：
今天是${dayjs().format("YYYY-MM-DD")}
1.如果请假时间和返校时间是同一天，则返校时间为次日日期
2.如果不是同一天，则按照原日期输出
3.若未提及日期，则请假日期为今天，返校日期为明天
4.若今天已经在返校时间后或返校当天，则按照失败情况输出

输出将被程序使用，如果输出格式不符合要求，会导致程序崩溃！
你只能输出纯文本，不支持markdown/latex等格式，务必严格按照以下格式输出：
若传入图片有效，只能输出该格式的JSON，不可用代码块包裹：
{"name":"姓名","start":"YYYY-MM-DD","end":"YYYY-MM-DD"}
如：
{"name":"张三","start":"2026-04-30","end":"2026-05-01"}
若无效，只能输出两个字：失败` },
                ]
            }],
    });
    console.log(completion.usage)
    if (completion.choices[0].message.content === "失败") {
        console.log("非请假消息")
    } else {
        console.log("请假消息", completion.choices[0].message.content)
        let res: Leave = JSON.parse(completion.choices[0].message.content ?? '')
        let data: Leave[] = JSON.parse(await readFile(dataFileName, 'utf-8'))
        let now = dayjs()
        // 过滤过期/同名记录
        data = data.filter(item => {
            return now.isBefore(dayjs(item.end)) && item.name !== res.name
        })
        data.push(res)
        await writeFile(dataFileName, JSON.stringify(data))
        console.log(JSON.stringify(data))
    }
}
async function main() {
    while (true) {
        await new Promise(resolve => setTimeout(resolve, 10))
        let WXSound = await getWXSound()
        if (WXSound) {
            handleWXMsg()
        }
    }
}
main()
// handleWXMsg()