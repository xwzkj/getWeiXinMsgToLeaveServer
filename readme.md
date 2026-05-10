# 请假服务-数据源

搭配[请假服务器](https://github.com/xwzkj/leaveServer)和[奶酪课程表](https://github.com/xwzkj/cheeseschedule)使用

## 环境变量

可放在.env文件中

``` text
API_URL=请假服务器API url
API_KEY=请假服务器API Key
AI_API_KEY=阿里云百炼的API Key
MAX_AI_CALL_COUNT=每天内，大模型最多触发次数（按照消息数计数，每条消息可能调用1-2次大模型）
```

## 使用方法

在有声卡的windows上，启动微信，打开请假消息的聊天窗口，关闭其他微信窗口

运行`node app.ts`
