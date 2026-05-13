const axios = require('axios');
const FormData = require('form-data');
const { parse } = require('parse-multipart-data');

const CONVERT_SECRET = '29E4EDmfLee8q4ZKUzA8ioAVLSrTOIH8';  // 替换！

const respond = (code, data) => ({
  statusCode: code,
  headers: {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*'
  },
  body: JSON.stringify(data)
});

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return respond(200, {});
  if (event.httpMethod !== 'POST') return respond(405, { success: false, error: '仅支持 POST' });

  try {
    // 1. 解析文件
    const contentType = event.headers['content-type'] || event.headers['Content-Type'] || '';
    const boundaryMatch = contentType.match(/boundary=(.*)/);
    if (!boundaryMatch) throw new Error('无法获取 boundary');
    const boundary = boundaryMatch[1];
    const bodyBuffer = Buffer.from(event.body, 'base64');
    const parts = parse(bodyBuffer, boundary);

    let fileBuffer = null, fileName = '', targetFormat = 'docx';
    for (const part of parts) {
      if (part.name === 'file') {
        fileBuffer = part.data;
        fileName = part.filename;
      } else if (part.name === 'targetFormat') {
        targetFormat = part.data.toString('utf-8').trim();
      }
    }
    if (!fileBuffer || !fileName) throw new Error('未收到文件');

    const fileExt = fileName.split('.').pop().toLowerCase();

    // 2. 上传文件到 ConvertAPI
    const form = new FormData();
    form.append('File', fileBuffer, { filename: fileName });
    const uploadRes = await axios.post(
      `https://v2.convertapi.com/upload?secret=${CONVERT_SECRET}`,
      form,
      { headers: form.getHeaders() }
    );
    if (uploadRes.data.Error) throw new Error(uploadRes.data.Error);
    const fileId = uploadRes.data.FileId;

    // 3. 提交异步转换
    const asyncRes = await axios.post(
      `https://v2.convertapi.com/async/convert/${fileExt}/to/${targetFormat}?secret=${CONVERT_SECRET}`,
      {
        Parameters: [
          { Name: 'FileId', Value: fileId },
          { Name: 'StoreFile', Value: 'true' },
          { Name: 'ImageQuality', Value: '100' },
          { Name: 'ImageResolution', Value: '300' }
        ]
      },
      { headers: { 'Content-Type': 'application/json' } }
    );
    if (asyncRes.data.Error) throw new Error(asyncRes.data.Error);
    const jobId = asyncRes.data.JobId;

    // 4. 轮询结果
    let resultUrl = null;
    for (let i = 0; i < 30; i++) {
      const jobRes = await axios.get(
        `https://v2.convertapi.com/async/job/${jobId}?secret=${CONVERT_SECRET}`
      );
      if (jobRes.data.Status === 'Completed') {
        resultUrl = jobRes.data.Files[0].Url;
        break;
      }
      if (jobRes.data.Status === 'Failed') throw new Error('转换任务失败');
      await new Promise(r => setTimeout(r, 2000));
    }
    if (!resultUrl) throw new Error('转换超时');

    // 5. 代理下载文件，转为 base64 返回
    const fileDownload = await axios.get(resultUrl, {
      responseType: 'arraybuffer'
    });
    const fileData = Buffer.from(fileDownload.data).toString('base64');

    // 生成自定义文件名：原文件名_converted.扩展名
    const baseName = fileName.replace(/\.[^/.]+$/, '');
    const ext = targetFormat === 'docx' ? 'docx' : targetFormat === 'pptx' ? 'pptx' : targetFormat;
    const outputFileName = `${baseName}_converted.${ext}`;

    return respond(200, {
      success: true,
      fileBase64: fileData,
      fileName: outputFileName
    });
  } catch (err) {
    console.error('云函数错误:', err.response?.data || err.message);
    return respond(500, { success: false, error: err.message || '内部错误' });
  }
};
