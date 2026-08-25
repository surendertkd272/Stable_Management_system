#pragma once
#include "DMSToolKit.h"

/// <summary>
/// ///////////////////////////////////////////////////////////////////////////////////////////////////////
/// </summary>
class CSDKDemo : public IDMDeviceEvent
{
public:
	CSDKDemo(const char * pCameraAddress, unsigned short CameraPort, const char * pUserName, const char * pPassWord);
	virtual ~CSDKDemo();

public:
	IDMDeviceControl *	m_pDriver;	
	bool				m_bBreaked;
	sem_t				m_hLoginEvent;
	sem_t				m_hExitEvent;
	pthread_mutex_t		m_BreakLock;

public:
	list<unsigned int>	m_FileSizeArray;
	list<string>		m_FileNameArray;

public:
	void ProcessMeasure();
	static void * MeasureThreadThread(void * pContext)
	{
		CSDKDemo* pProcessThread = (CSDKDemo*)pContext;
		pProcessThread->ProcessMeasure();
		return 0;
	}

public:
	void QueryTest();
	void MeasureTest();

public:
	void OnLogin(const char* pResponseStr, bool bLoginSuccess);

	void OnLogout(const char* pResponseStr, bool bLogoutSuccess);

public:
	void OnOperationResponse(unsigned int OperationType, const char* pResponseStr, bool bOperationSuccess);

public:
	void OnDeviceSN(const char* pDeviceSN);

	void OnDeviceName(const char* pDeviceName);

	void OnDeviceModel(const char* pDeviceModelName);

	void OnDeviceModule(const char* pModuleType, _CAMERA_TYPE CameraType);

	void OnDeviceSensor(unsigned short ResolutionX, unsigned short ResolutionY, _CAMERA_TYPE CameraType);

	void OnDeviceFirmWare(const char* pFirmWareVer, const char* pFirmWareDate);

	void OnDeviceState(bool bRecording, bool bAlarmActive);

	void OnDeviceAbility(unsigned int SupportMask);

	void OnNetWorkBasicParam(const char* pIPAddress, const char* pNetMask, const char* pGateway, const char* pMacAddress);

	void OnNetWorkExtParam(const char* pDNSAddress, const char* pDNSAddress2, bool bDHCPEnable, bool bMulticastEnable);

	void OnNetWorkWifiParam(const char* pIPAddress, const char* pPassWord, const char* pSSID, bool bDHCPEnable, bool bWIFIEnable);

	void OnNetWorkFtpParam(const char* pFtpServerIP, unsigned short FtpPort, const char* pUserName, const char* pPassWord, const char* pStoreDirectory, bool bAnonymityEnable, bool bFTPEnable);

	void OnNetWorkSmtpParam(const char* pSmtpServerIP, unsigned short SmtpPort, const char* pUserName, const char* pPassWord, const char* pFromAddr, const char* ReceiptAddr1, const char* ReceiptAddr2, const char* ReceiptAddr3, const char* ReceiptAddr4, bool bSSLEnable, bool bSMTPEnable);

	void OnNetWorkHttpsParam(bool bHttpsEnable);

	void OnNetWorkOnvifParam(unsigned short AuthType, unsigned short OnvifPort, bool bOnvifEnable);

	void OnNetWorkGB28181Param(const char* pSipServerIP, unsigned short SipServerPort, const char* pServerDomain, const char* pServerSipName, const char* pDeviceSipName, const char* pDeviceSipPSW, unsigned short LocalPort);

	void OnNetWorkGB28181State(bool bRegisterStatus, unsigned short SessionExpires, unsigned short HeartBeatTime, unsigned short HeartBeatCount, bool bGB28181Enable);

	void OnNetWorkGB28181DVID(unsigned short VideoDeviceCounts, const char* pVideoDeviceSipName[]);

	void OnTimeParam(const char* pTimeZone, const char* pLocalTime, const char* pUpTime);

	void OnTimeNtp(const char* pNtpServerIP, unsigned short NtpPort, unsigned short Interval, bool bNtpEnable);

	void OnRtspStreamAddress(_STREAM_TYPE StreamChannelType, bool bSubStream, const char* pRTSPStreamAddress);

	void OnHttpStreamAddress(_STREAM_TYPE StreamChannelType, bool bSubStream, const char* pFLVStreamAddress);

	void OnImagePalette(unsigned short PaletteID);

	void OnImageBasicParam(_STREAM_TYPE StreamChannelType, const char* pLanguage, bool bMirror, bool bFlip);

	void OnImageEnhanceParam(_STREAM_TYPE StreamChannelType, unsigned int EnhanceType, bool bAutoMode, unsigned char Value);

	void OnVideoEncoderParam(_STREAM_TYPE StreamChannelType, bool bSubStream, unsigned short EncodeResolutionX, unsigned short EncodeResolutionY, unsigned short EncodeFrameRate);

	void OnVideoDefaultOSD(_STREAM_TYPE StreamChannelType, bool bSubStream, _MeasurePos_XY PosXY, const char* pDisplayContent, bool bEnable);

	void OnVideoDateTimeOSD(_STREAM_TYPE StreamChannelType, bool bSubStream, _MeasurePos_XY PosXY, bool bEnable);

	void OnVideoCustomOSD(_STREAM_TYPE StreamChannelType, bool bSubStream, unsigned short DisplayContentCounts, _MeasurePos_XY DisplayContentPosXY[], const char* pDisplayContent[]);

	void OnUartExParam(unsigned int BaudRate, unsigned char DataBits, unsigned char StopBits, unsigned char Parity);
	void OnLensCtrlParam(unsigned char CameraZoom, bool bIRCutOn, _CAMERA_TYPE CameraType);
	void OnPTZAngleParam(int HAngleX100, int VAngleX100);

	void OnPTZPresetNum(unsigned short PresetCounts);
	void OnPTZPresetInfo(unsigned short PresetID, const char* pPresetName, bool bEnable);
	void OnPTZPresetEnd();

	void OnPointMeasureParamCallBack(unsigned short PresetID, unsigned short Counts, unsigned short PointIDArray[], _MeasurePos_XY PosXYArray[], unsigned short FPara100Array[], unsigned short AimDistanceArray[]);
	void OnLineMeasureParamCallBack(unsigned short PresetID, unsigned short Counts, unsigned short LineIDArray[], _MeasurePos_XY PosXY1Array[], _MeasurePos_XY PosXY2Array[], unsigned short FPara100Array[], unsigned short AimDistanceArray[]);
	void OnAreaMeasureParamCallBack(unsigned short PresetID, unsigned short Counts, unsigned short AreaIDArray[], vector<_MeasurePos_XY> PosXYArray[], unsigned short FPara100Array[], unsigned short AimDistanceArray[]);

	void OnThermometryPointNum(unsigned short PresetID, unsigned short PointCounts);
	void OnThermometryPoint(unsigned short PresetID, unsigned short PointID, _MeasurePos_XY PosXY, int ValueX10);
	void OnThermometryPointEnd(unsigned short PresetID);

	void OnThermometryLineNum(unsigned short PresetID, unsigned short LineCounts);
	void OnThermometryLineMax(unsigned short PresetID, unsigned short LineID, _MeasurePos_XY PosXY, int ValueX10);
	void OnThermometryLineAvg(unsigned short PresetID, unsigned short LineID, int ValueX10);
	void OnThermometryLineMin(unsigned short PresetID, unsigned short LineID, _MeasurePos_XY PosXY, int ValueX10);
	void OnThermometryLineEnd(unsigned short PresetID);

	void OnThermometryAreaNum(unsigned short PresetID, unsigned short AreaCounts);
	void OnThermometryAreaMax(unsigned short PresetID, unsigned short AreaID, _MeasurePos_XY PosXY, int ValueX10);
	void OnThermometryAreaAvg(unsigned short PresetID, unsigned short AreaID, int ValueX10);
	void OnThermometryAreaMin(unsigned short PresetID, unsigned short AreaID, _MeasurePos_XY PosXY, int ValueX10);
	void OnThermometryAreaEnd(unsigned short PresetID);

	void OnMMCStorageParam(unsigned short MMCStatus, const char* pTotalSize, const char* pAvailableSize, unsigned short FullGrade, bool bFullAlarmEnable, bool bOverWriteEnable, bool bMMCEnable);
	void OnNASStorageParam(unsigned short NASStatus, const char* pTotalSize, const char* pAvailableSize, unsigned short FullGrade, bool bFullAlarmEnable, bool bOverWriteEnable, bool bNASEnable);

	void OnStorageFileNum(unsigned int FileCounts);
	void OnStorageFileInfo(unsigned int FileSizeBytes, const char* pFileName);
	void OnStorageFileEnd();

	void OnMediaFileDownLoad(_MEDIA_REC_SRC_ MediaRecType, _MEDIA_FILE_TYPE_ MediaFileType, _MEDIA_FORMAT_TYPE_ FileFormatType, _STREAM_TYPE StreamChannelType, const char* pFilePathName, unsigned int MediaLengthBytes, void* pMediaDataBuffer);
};
