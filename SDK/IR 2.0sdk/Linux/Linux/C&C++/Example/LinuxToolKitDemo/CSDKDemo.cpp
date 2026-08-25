#include "CSDKDemo.h"
#include <unistd.h>

CSDKDemo::CSDKDemo(const char * pCameraAddress, unsigned short CameraPort, const char * pUserName, const char * pPassWord)
{
	m_pDriver = (IDMDeviceControl *)CreateDMControlDriverEx((void *)this);
	m_pDriver->OpenDevice(pCameraAddress, CameraPort, pUserName, pPassWord);

	m_bBreaked = true;
	pthread_mutex_init(&m_BreakLock, 0);

	sem_init(&m_hLoginEvent, 0, 0);
	sem_init(&m_hExitEvent, 0, 1);	
}

CSDKDemo::~CSDKDemo()
{
	if (m_pDriver)
	{
		pthread_mutex_lock(&m_BreakLock);
		{
			m_bBreaked = true;
		}
		pthread_mutex_unlock(&m_BreakLock);
		
		sem_wait(&m_hExitEvent);
		sem_close(&m_hLoginEvent);
		sem_close(&m_hExitEvent);

		m_FileSizeArray.clear();
		m_FileNameArray.clear();
		m_pDriver->CloseDevice();

		DestoryDMControlDriver(m_pDriver);
		m_pDriver = NULL;
	}
	
	pthread_mutex_destroy(&m_BreakLock);
}

//查询测试
void CSDKDemo::QueryTest()
{
	//等待登录成功后,立即执行
	if (0 == sem_wait(&m_hLoginEvent))
	{
		m_pDriver->QueryDeviceSN();
		m_pDriver->QueryDeviceName();
		m_pDriver->QueryDeviceModel();
		m_pDriver->QueryDeviceModule();
		m_pDriver->QueryDeviceSensor();
		m_pDriver->QueryDeviceState();
		m_pDriver->QueryDeviceFirmWare();
		m_pDriver->QueryDeviceAbility();
		m_pDriver->QueryNetWorkBasicParam();
		m_pDriver->QueryNetWorkExtParam();
		m_pDriver->QueryNetWorkWifiParam();
		m_pDriver->QueryNetWorkFtpParam();
		m_pDriver->QueryNetWorkSmtpParam();
		m_pDriver->QueryNetWorkHttpsParam();
		m_pDriver->QueryNetWorkOnvifParam();
		m_pDriver->QueryNetWorkGB28181Param();
		m_pDriver->QueryNetWorkGB28181State();
		m_pDriver->QueryNetWorkGB28181DVID();
		m_pDriver->QueryVideoEncoderParam(STREAM_IR, false);
		m_pDriver->QueryVideoEncoderParam(STREAM_CCD, false);			

		//m_pDriver->CallPreset(0);
		//sleep(3);
		//m_pDriver->CallPreset(2);
		//sleep(3);
		//m_pDriver->CallPreset(3);
		//sleep(3);

		m_pDriver->SetPointMeasure(0xFF, false);
		m_pDriver->SetLineMeasure(0xFF, false);
		m_pDriver->SetAreaMeasure(0xFF, false);

		//m_pDriver->DownLoadMediaFile("ir.jpg", STREAM_IR, _MEM_MEDIA_, _PIC_FILE_, _JPG_GWS_SUFFIX);
		//m_pDriver->DownLoadMediaFile("ccd.jpg", STREAM_CCD);
		//m_pDriver->QueryMediaList("2023-02-24_00:00:00", "2023-03-02_16:04:13", 0, _HDD_MEDIA_, _VIDEO_FILE_, _ATTRIB_ALL);
		sleep(3);
	}
}

//测温测试
void CSDKDemo::MeasureTest()
{	
	//演示测温点线区域设定
	m_pDriver->SetPointMeasure(0, true, 50, 100);

	m_pDriver->SetPointMeasure(1, true, 100, 50);

	m_pDriver->SetPointMeasure(2, true, 50, 100);

	m_pDriver->SetPointMeasure(3, true, 75, 120);

	m_pDriver->SetPointMeasure(4, true, 120, 230);

	m_pDriver->SetPointMeasure(5, true, 234, 300);


	m_pDriver->SetLineMeasure(0, true, 0,0,200,200);

	m_pDriver->SetLineMeasure(1, true, 10, 10, 300, 150);

	m_pDriver->SetLineMeasure(2, true, 100, 5, 150, 200);

	m_pDriver->SetAreaMeasure(0, true, 80, 80, 90, 90);

	m_pDriver->SetAreaMeasure(1, true, 80, 80, 100, 190);

	_ScreenPixPos_XY ScreenPixPosXY[5] = { 0 };
	ScreenPixPosXY[0].PosX = 50; ScreenPixPosXY[0].PosY = 50;
	ScreenPixPosXY[1].PosX = 400; ScreenPixPosXY[1].PosY = 50;
	ScreenPixPosXY[2].PosX = 350; ScreenPixPosXY[2].PosY = 100;
	ScreenPixPosXY[3].PosX = 260; ScreenPixPosXY[3].PosY = 250;
	ScreenPixPosXY[4].PosX = 160; ScreenPixPosXY[4].PosY = 150;

	vector<_ScreenPixPos_XY> PosXY;
	PosXY.push_back(ScreenPixPosXY[0]);
	PosXY.push_back(ScreenPixPosXY[1]);
	PosXY.push_back(ScreenPixPosXY[2]);
	PosXY.push_back(ScreenPixPosXY[3]);
	PosXY.push_back(ScreenPixPosXY[4]);
	m_pDriver->SetAreaPolygonPosMeasureEx(2, true, PosXY, 90, 90);
		
	//演示独立线程定时查询测温结果
	pthread_t Thread;
	pthread_create(&Thread, 0, MeasureThreadThread, this);

	sleep(3600*24);
}

//定时测温线程
void CSDKDemo::ProcessMeasure()
{
	sem_trywait(&m_hExitEvent);

	m_bBreaked = false;

	unsigned int Seconds = 0;
	bool bBreakThread = false;
	while (!bBreakThread)
	{
		if (!m_pDriver->QueryThermometryPoint())
		{
			//点测温失败,则退出测温
			break;
		}
		
		if (!m_pDriver->QueryThermometryLine())
		{
			//线测温失败,则退出测温
			break;
		}
		
		if (!m_pDriver->QueryThermometryArea())
		{
			//区域测温失败,则退出测温
			break;
		}
		m_pDriver->QueryPointMeasureParam();

		m_pDriver->QueryLineMeasureParam();

		m_pDriver->QueryAreaMeasureParam();

		m_pDriver->QueryPTZAngleParam();
		
		if ((Seconds % 100) == 0)
		{
			//每100秒切换红外图像的调色板
			m_pDriver->SetImagePalette((Seconds/100)%14);
		}
		Seconds++;
		sleep(1);
		
		pthread_mutex_lock(&m_BreakLock);
		{
			bBreakThread = m_bBreaked;
		}
		pthread_mutex_unlock(&m_BreakLock);
	}

	sem_post(&m_hExitEvent);
}

void CSDKDemo::OnLogin(const char * pResponseStr, bool bLoginSuccess)
{
	cout << "[OnLogin] ResponseStr =" << pResponseStr << endl;
	sem_post(&m_hLoginEvent);
}

void CSDKDemo::OnLogout(const char * pResponseStr, bool bLogoutSuccess)
{
	cout << "[OnLogout] ResponseStr=" << pResponseStr << endl;	
}
void CSDKDemo::OnOperationResponse(unsigned int OperationType, const char* pResponseStr, bool bOperationSuccess)
{
	cout << "[OnLogout] ResponseStr=" << pResponseStr << endl;
}
//////////////////////////////////////////////////////////////////////////////////////////////////////////
//											查询应答														//
//////////////////////////////////////////////////////////////////////////////////////////////////////////
void CSDKDemo::OnDeviceSN(const char * pDeviceSN)
{
	cout << "[OnDeviceSN] DeviceSN=" << pDeviceSN << endl;
}

void CSDKDemo::OnDeviceName(const char * pDeviceName)
{
	cout << "[OnDeviceName] DeviceName=" << pDeviceName << endl;
}

void CSDKDemo::OnDeviceModel(const char * pDeviceModelName)
{
	cout << "[OnDeviceModel] ModelName =" << pDeviceModelName << endl;
}

void CSDKDemo::OnDeviceModule(const char * pModuleType, _CAMERA_TYPE CameraType)
{
	string IRModule = CameraType == CAMERA_IR ? "TRUE" : "FALSE";
	cout << "[OnDeviceModule] bIRModule=" << IRModule << ", ModuleType=" << pModuleType << endl;
}

void CSDKDemo::OnDeviceSensor(unsigned short ResolutionX, unsigned short ResolutionY, _CAMERA_TYPE CameraType)
{
	string IRSensor = CameraType == CAMERA_IR ? "TRUE" : "FALSE";
	cout << "[OnDeviceSensor] bIRSensor=" << IRSensor << ", ResolutionX = " << ResolutionX << ", ResolutionY = " << ResolutionY << endl;
}

void CSDKDemo::OnDeviceFirmWare(const char * pFirmWareVer, const char * pFirmWareDate)
{
	cout << "[OnDeviceFirmWare] FirmWareVer = " << pFirmWareVer << ", FirmWareDate = " << pFirmWareDate << endl;
}

void CSDKDemo::OnDeviceState(bool bRecording, bool bAlarmActive)
{
	string Recording = bRecording ? "TRUE" : "FALSE";
	string AlarmActive = bAlarmActive ? "TRUE" : "FALSE";

	cout << "[OnDeviceState] bRecording=" << Recording << ", bAlarmActive = " << AlarmActive << endl;
}

void CSDKDemo::OnDeviceAbility(unsigned int SupportMask)
{
	cout << "[OnDeviceAbility] SUPPORT >>>>>>>>>>>>>>>>>" << endl;

	cout << "                  SUPPORT_DISTANCEADJUST=" << ((SUPPORT_DISTANCEADJUST & SupportMask) ? ("Yes") : ("No")) << endl;

	cout << "                  SUPPORT_TLUNCH=" << ((SUPPORT_TLUNCH & SupportMask) ? ("Yes") : ("No")) << endl;

	cout << "                  SUPPORT_TDEXT=" << ((SUPPORT_TDEXT & SupportMask) ? ("Yes") : ("No")) << endl;

	cout << "                  SUPPORT_WIFI=" << ((SUPPORT_WIFI & SupportMask) ? ("Yes") : ("No")) << endl;

	cout << "                  SUPPORT_HT10=" << ((SUPPORT_HT10 & SupportMask) ? ("Yes") : ("No")) << endl;

	cout << "                  SUPPORT_GB28181=" << ((SUPPORT_GB28181 & SupportMask) ? ("Yes") : ("No")) << endl;

	cout << "                  SUPPORT_DMMEASURE=" << ((SUPPORT_DMMEASURE & SupportMask) ? ("Yes") : ("No")) << endl;

	cout << "                  SUPPORT_STORAGE=" << ((SUPPORT_STORAGE & SupportMask) ? ("Yes") : ("No")) << endl;

	cout << "                  SUPPORT_IMAGE=" << ((SUPPORT_IMAGE & SupportMask) ? ("Yes") : ("No")) << endl;

	cout << "                  SUPPORT_SHIELD=" << ((SUPPORT_SHIELD & SupportMask) ? ("Yes") : ("No")) << endl;

	cout << "                  SUPPORT_BLACKBODY=" << ((SUPPORT_BLACKBODY & SupportMask) ? ("Yes") : ("No")) << endl;

	cout << "                  SUPPORT_CCD=" << ((SUPPORT_CCD & SupportMask) ? ("Yes") : ("No")) << endl;

	cout << "                  SUPPORT_PTZ=" << ((SUPPORT_PTZ & SupportMask) ? ("Yes") : ("No")) << endl;

	cout << "                  SUPPORT_FACEDETECT=" << ((SUPPORT_FACEDETECT & SupportMask) ? ("Yes") : ("No")) << endl;

	cout << "                  SUPPORT_CLIENTMEASURE=" << ((SUPPORT_CLIENTMEASURE & SupportMask) ? ("Yes") : ("No")) << endl;

	cout << "                  SUPPORT_METARAW=" << ((SUPPORT_METARAW & SupportMask) ? ("Yes") : ("No")) << endl;

	cout << "[OnDeviceAbility] SUPPORT <<<<<<<<<<<<<<<<<" << endl;
}


void CSDKDemo::OnNetWorkBasicParam(const char * pIPAddress, const char * pNetMask, const char * pGateway, const char * pMacAddress)
{
	cout << "[OnNetWorkBasicParam] IPAddress=" << pIPAddress << ", NetMask = " << pNetMask << ", Gateway =" << pGateway << ", MacAddress = " << pMacAddress << endl;

}

void CSDKDemo::OnNetWorkExtParam(const char * pDNSAddress, const char * pDNSAddress2, bool bDHCPEnable, bool bMulticastEnable)
{
	cout << "[OnNetWorkExtParam] DNSAddress=" << pDNSAddress << " DNSAddress2=" << pDNSAddress2 << " bDHCPEnable=" << (bDHCPEnable ? "TRUE" : "FALSE") << " bMulticastEnable=" << (bMulticastEnable ? "TRUE" : "FALSE") << endl;
}

void CSDKDemo::OnNetWorkWifiParam(const char * pIPAddress, const char * pPassWord, const char * pSSID, bool bDHCPEnable, bool bWIFIEnable)
{
	cout << "[OnNetWorkWifiParam] WiFiIPAddress="<< pIPAddress <<" SSID="<< pSSID <<" bDHCPEnable="<<(bDHCPEnable ? "TRUE" : "FALSE")<<" bWIFIEnable="<<(bWIFIEnable ? "TRUE" : "FALSE")<<endl;
}

void CSDKDemo::OnNetWorkFtpParam(const char * pFtpServerIP, unsigned short FtpPort, const char * pUserName, const char * pPassWord, const char * pStoreDirectory, bool bAnonymityEnable, bool bFTPEnable)
{
	cout << "[OnNetWorkFtpParam] FtpServerIP="<<(pFtpServerIP)<<" UserName="<< pUserName <<" bAnonymityEnable="<<(bAnonymityEnable ? "TRUE" : "FALSE")<<" bFTPEnable="<<(bFTPEnable ? "TRUE" : "FALSE")<<endl;
}

void CSDKDemo::OnNetWorkSmtpParam(const char * pSmtpServerIP, unsigned short SmtpPort, const char * pUserName, const char * pPassWord, const char * pFromAddr, const char * ReceiptAddr1, const char * ReceiptAddr2, const char * ReceiptAddr3, const char * ReceiptAddr4, bool bSSLEnable, bool bSMTPEnable)
{
	cout << "[OnNetWorkSmtpParam] SmtpServerIP="<< pSmtpServerIP <<" UserName="<< pUserName <<" FromAddr="<< pFromAddr <<" bSSLEnable="<<(bSSLEnable ? "TRUE" : "FALSE")<<" bSMTPEnable="<<(bSMTPEnable ? "TRUE" : "FALSE") <<endl;
}

void CSDKDemo::OnNetWorkHttpsParam(bool bHttpsEnable)
{
	cout << "[OnNetWorkHttpsParam] bHttpsEnable="<<(bHttpsEnable ? "TRUE" : "FALSE")<<endl;
}

void CSDKDemo::OnNetWorkOnvifParam(unsigned short AuthType, unsigned short OnvifPort, bool bOnvifEnable)
{
	cout << "[OnNetWorkOnvifParam] bOnvifEnable="<<(bOnvifEnable ? "TRUE" : "FALSE")<<endl;
}

void CSDKDemo::OnNetWorkGB28181Param(const char * pSipServerIP, unsigned short SipServerPort, const char * pServerDomain, const char * pServerSipName, const char * pDeviceSipName, const char * pDeviceSipPSW, unsigned short LocalPort)
{
	cout << "[OnNetWorkGB28181Param] SipServerIP="<< pSipServerIP <<"  ServerSipName="<< pServerSipName <<" DeviceSipName="<< pDeviceSipName <<endl;
}

void CSDKDemo::OnNetWorkGB28181State(bool bRegisterStatus, unsigned short SessionExpires, unsigned short HeartBeatTime, unsigned short HeartBeatCount, bool bGB28181Enable)
{
	cout << "[OnNetWorkGB28181State] bGB28181Enable="<<(bGB28181Enable ? "TRUE" : "FALSE")<<"  bRegisterStatus="<<(bRegisterStatus ? "TRUE" : "FALSE")<<endl;
}

void CSDKDemo::OnNetWorkGB28181DVID(unsigned short VideoDeviceCounts, const char* pVideoDeviceSipName[])
{
	cout << "[OnNetWorkGB28181DVID] VIDEODEVICE >>>>>>>>>>>>>>>>>"<<endl;
	
	for (int i = 0; i < VideoDeviceCounts; i++)
	{
		if (pVideoDeviceSipName[i])
		{
			cout << (i + 1) << " VideoDeviceSipName = " << pVideoDeviceSipName[i] << endl;
		}
	}

	cout << "[OnNetWorkGB28181DVID] VIDEODEVICE <<<<<<<<<<<<<<<<<"<<endl;
}


void CSDKDemo::OnTimeParam(const char * pTimeZone, const char * pLocalTime, const char * pUpTime)
{
	cout << "[OnTimeParam] TimeZone = "<< pTimeZone <<" LocalTime = "<< pLocalTime <<" UpTime = "<< pUpTime <<endl;
}

void CSDKDemo::OnTimeNtp(const char * pNtpServerIP, unsigned short NtpPort, unsigned short Interval, bool bNtpEnable)
{
	cout << "[OnTimeNtp] NtpServerIP = "<< pNtpServerIP <<"  bNtpEnable="<<(bNtpEnable ? "TRUE" : "FALSE")<<endl; 
}

void CSDKDemo::OnImagePalette(unsigned short PaletteID)
{
	cout << "[OnImagePalette] PaletteID = " << PaletteID << endl;
}

void CSDKDemo::OnImageBasicParam(_STREAM_TYPE StreamChannelType, const char * pLanguage, bool bMirror, bool bFlip)
{
	cout << "[OnImageBasicParam] Language = "<< pLanguage <<" bMirror="<<(bMirror ? "TRUE" : "FALSE")<<" bFlip="<<(bFlip ? "TRUE" : "FALSE")<<endl;
}

void CSDKDemo::OnImageEnhanceParam(_STREAM_TYPE StreamChannelType, unsigned int ParamType, bool bAutoMode, unsigned char Value)
{
	string EnhanceType;
	switch (ParamType)
	{
		case IR_BRIGHTNESS:		EnhanceType += ("IR_BRIGHTNESS");	break;
		case IR_GAIN:			EnhanceType += ("IR_GAIN");			break;
		case IR_SHARPNESS:		EnhanceType += ("IR_SHARPNESS");	break;
		case IR_ENHANCE:		EnhanceType += ("IR_ENHANCE");		break;
		case IR_FILTER:			EnhanceType += ("IR_FILTER");		break;								
		case CCD_BRIGHTNESS:	EnhanceType += ("CCD_BRIGHTNESS");	break;
		case CCD_CONTRAST:		EnhanceType += ("CCD_CONTRAST");	break;
		case CCD_HUE:			EnhanceType += ("CCD_HUE");			break;
		case CCD_SATURATION:	EnhanceType += ("CCD_SATURATION");	break;
		case CCD_WDR:			EnhanceType += ("CCD_WDR");			break;
	}

	cout << "[OnImageEnhanceParam] EnhanceType = " << EnhanceType << " bAutoMode = " << (bAutoMode ? "TRUE" : "FALSE") << " Value=" << Value << endl;
}


void CSDKDemo::OnRtspStreamAddress(_STREAM_TYPE StreamChannelType, bool bSubStream, const char * pRTSPStreamAddress)
{
	cout << "[OnRtspStreamAddress] CameraChannelID = "<< StreamChannelType <<", bSubStream = "<<(bSubStream ? "TRUE" : "FALSE")<<" pRTSPStreamAddress="<< pRTSPStreamAddress <<endl;
}

void CSDKDemo::OnHttpStreamAddress(_STREAM_TYPE StreamChannelType, bool bSubStream, const char * pFLVStreamAddress)
{
	cout << "[OnHttpStreamAddress] CameraChannelID = "<< StreamChannelType<<", bSubStream = "<<(bSubStream ? "TRUE" : "FALSE")<<" pFLVStreamAddress="<< pFLVStreamAddress << endl;
}

void CSDKDemo::OnVideoEncoderParam(_STREAM_TYPE StreamChannelType, bool bSubStream, unsigned short EncodeResolutionX, unsigned short EncodeResolutionY, unsigned short EncodeFrameRate)
{
	cout << "[OnVideoResolution] CameraChannelID = " << StreamChannelType << ", bSubStream = " << (bSubStream ? "TRUE" : "FALSE") << " EncodeResolutionX = " << EncodeResolutionX << ", EncodeResolutionY = " << EncodeResolutionY << ", EncodeFrameRate = " << EncodeFrameRate << endl;
}

void CSDKDemo::OnVideoDefaultOSD(_STREAM_TYPE StreamChannelType, bool bSubStream, _MeasurePos_XY PosXY, const char * pDisplayContent, bool bEnable)
{
	cout << "[OnVideoDefaultOSD] DisplayContent = "<< pDisplayContent <<endl;
}

void CSDKDemo::OnVideoCustomOSD(_STREAM_TYPE StreamChannelType, bool bSubStream, unsigned short DisplayContentCounts, _MeasurePos_XY DisplayContentPosXY[], const char* pDisplayContent[])
{
	cout << "[OnVideoCustomOSD] >>>>>>>>>>>>>>>>>>"<<endl;
	for (int i = 0; i < DisplayContentCounts; i++)
	{
		if (pDisplayContent[i])
		{
			cout << "DisplayContent = " << pDisplayContent[i] << endl;
		}
	}
	cout << "[OnVideoCustomOSD] <<<<<<<<<<<<<<<<<<"<<endl;
}

void CSDKDemo::OnVideoDateTimeOSD(_STREAM_TYPE StreamChannelType, bool bSubStream, _MeasurePos_XY PosXY, bool bEnable)
{
	cout << "[OnVideoDateTimeOSD] PosX = " << PosXY.PosX << ", PosY = " << PosXY.PosY << ", bEnable = " << (bEnable ? "TRUE" : "FALSE") << endl;
}


void CSDKDemo::OnUartExParam(unsigned int BaudRate, unsigned char DataBits, unsigned char StopBits, unsigned char Parity)
{
	cout << "[OnUartExParam] BaudRate = " << BaudRate << endl;
}

void CSDKDemo::OnLensCtrlParam(unsigned char CameraZoom, bool bIRCutOn, _CAMERA_TYPE CameraType)
{
	cout << "[OnLensCtrlParam] CameraZoom = " << CameraZoom << endl;
}

void CSDKDemo::OnPTZAngleParam(int HAngleX100, int VAngleX100)
{	
	cout << "[OnPTZAngleParam] HAngle = "<< HAngleX100 / 100.0f << " VAngle = "<< VAngleX100 / 100.0f <<"\r\n" << endl;
}

void CSDKDemo::OnPTZPresetNum(unsigned short PresetCounts)
{
	cout << "[OnPTZPresetCounts] PresetCounts = " << PresetCounts << endl;
}

void CSDKDemo::OnPTZPresetInfo(unsigned short PresetID, const char * pPresetName, bool bEnable)
{
	cout << "[OnPTZPresetCounts] PresetID = " << PresetID << ", PresetName = " << pPresetName << " bEnable = " << (bEnable ? "TRUE" : "FALSE") << endl;
}

void CSDKDemo::OnPTZPresetEnd()
{
	cout << "[OnPTZPresetEnd] End" << endl;
}



void CSDKDemo::OnPointMeasureParamCallBack(unsigned short PresetID, unsigned short Counts, unsigned short PointIDArray[], _MeasurePos_XY PosXYArray[], unsigned short FPara100Array[], unsigned short AimDistanceArray[])
{
	cout << "[OnPointMeasureParam] >>>>>>>>>>>>>>>>>>" << endl;
	for (int i = 0; i < Counts; i++)
	{
		cout << "PointID = " << PointIDArray[i] << ", FPara100 = " << FPara100Array[i] << ", AimDistance = " << AimDistanceArray[i] << endl;
		cout << "PosX = " << PosXYArray[i].PosX << ", PosY = " << PosXYArray[i].PosY << endl;
	}
	cout << "[OnPointMeasureParam] <<<<<<<<<<<<<<<<<<" << endl;
}
void CSDKDemo::OnLineMeasureParamCallBack(unsigned short PresetID, unsigned short Counts, unsigned short LineIDArray[], _MeasurePos_XY PosXY1Array[], _MeasurePos_XY PosXY2Array[], unsigned short FPara100Array[], unsigned short AimDistanceArray[])
{
	cout << "[OnLineMeasureParam] >>>>>>>>>>>>>>>>>>" << endl;
	for (int i = 0; i < Counts; i++)
	{
		cout << "LineID = " << LineIDArray[i] << ", FPara100 = " << FPara100Array[i] << ", AimDistance = " << AimDistanceArray[i] << endl;
		cout << "PosX1 = " << PosXY1Array[i].PosX << ", PosY1 = " << PosXY1Array[i].PosY << ", PosX2 = " << PosXY2Array[i].PosX << ", PosY2 = " << PosXY2Array[i].PosY << endl;
	}
	cout << "[OnLineMeasureParam] <<<<<<<<<<<<<<<<<<" << endl;
}
void CSDKDemo::OnAreaMeasureParamCallBack(unsigned short PresetID, unsigned short Counts, unsigned short AreaIDArray[], vector<_MeasurePos_XY> PosXYArray[], unsigned short FPara100Array[], unsigned short AimDistanceArray[])
{
	cout << "[OnAreaMeasureParam] >>>>>>>>>>>>>>>>>>" << endl;
	for (int i = 0; i < Counts; i++)
	{
		cout << "AreaID = " << AreaIDArray[i] << ", FPara100 = " << FPara100Array[i] << ", AimDistance = " << AimDistanceArray[i] << endl;

		int Points = PosXYArray[i].size();
		for (int j = 0; j < Points; j++)
		{
			cout << "PosX = " << PosXYArray[i][j].PosX << ", PosY = " << PosXYArray[i][j].PosY << endl;
		}
	}
	cout << "[OnAreaMeasureParam] <<<<<<<<<<<<<<<<<<" << endl;
}

void CSDKDemo::OnThermometryPointNum(unsigned short PresetID, unsigned short PointCounts)
{
	cout << "[OnThermometryPointNum] PointCounts = " << PointCounts << endl;
}

void CSDKDemo::OnThermometryPoint(unsigned short PresetID, unsigned short PointID, _MeasurePos_XY PosXY, int ValueX10)
{
	cout << "[OnThermometryPoint] PosX = " << PosXY.PosX << ", PosY = " << PosXY.PosY << ", Value = " << ValueX10 / 10.0f << endl;
}

void CSDKDemo::OnThermometryPointEnd(unsigned short PresetID)
{
	cout << "[OnThermometryPointEnd] End" << endl;
}

void CSDKDemo::OnThermometryLineNum(unsigned short PresetID, unsigned short LineCounts)
{
	cout << "[OnThermometryLineNum] LineCounts = " << LineCounts << endl;
}

void CSDKDemo::OnThermometryLineMax(unsigned short PresetID, unsigned short LineID, _MeasurePos_XY PosXY, int ValueX10)
{
	cout << "[OnThermometryLineMax] PosX = " << PosXY.PosX << ", PosY = " << PosXY.PosY << ", Value = " << ValueX10 / 10.0f << endl;
}

void CSDKDemo::OnThermometryLineAvg(unsigned short PresetID, unsigned short LineID, int ValueX10)
{
	cout << "[OnThermometryLineAvg] Value = " << ValueX10 / 10.0f << endl;
}

void CSDKDemo::OnThermometryLineMin(unsigned short PresetID, unsigned short LineID, _MeasurePos_XY PosXY, int ValueX10)
{
	cout << "[OnThermometryLineMin] PosX = " << PosXY.PosX << ", PosY = " << PosXY.PosY << ", Value = " << ValueX10 / 10.0f << endl;
}

void CSDKDemo::OnThermometryLineEnd(unsigned short PresetID)
{
	cout << "[OnThermometryLineEnd] End" << endl;
}

void CSDKDemo::OnThermometryAreaNum(unsigned short PresetID, unsigned short AreaCounts)
{
	cout << "[OnThermometryAreaNum] AreaCounts = " << AreaCounts << endl;
}

void CSDKDemo::OnThermometryAreaMax(unsigned short PresetID, unsigned short AreaID, _MeasurePos_XY PosXY, int ValueX10)
{
	cout << "[OnThermometryAreaMax] PosX = " << PosXY.PosX << ", PosY = " << PosXY.PosY << ", Value = " << ValueX10 / 10.0f << endl;
}

void CSDKDemo::OnThermometryAreaAvg(unsigned short PresetID, unsigned short AreaID, int ValueX10)
{
	cout << "[OnThermometryAreaAvg] Value" << ValueX10 / 10.0f << endl;
}

void CSDKDemo::OnThermometryAreaMin(unsigned short PresetID, unsigned short AreaID, _MeasurePos_XY PosXY, int ValueX10)
{
	cout << "[OnThermometryAreaMin] PosX = " << PosXY.PosX << ", PosY = " << PosXY.PosY << ", Value = " << ValueX10 / 10.0f << endl;
}

void CSDKDemo::OnThermometryAreaEnd(unsigned short PresetID)
{
	cout << "[OnThermometryAreaEnd] End"<<endl;
}

void CSDKDemo::OnMMCStorageParam(unsigned short MMCStatus, const char * pTotalSize, const char * pAvailableSize, unsigned short FullGrade, bool bFullAlarmEnable, bool bOverWriteEnable, bool bMMCEnable)
{
	cout << "[OnMMCStorageParam] TotalSize = " << pTotalSize << ", AvailableSize = " << pAvailableSize << ", bMMCEnable = " << (bMMCEnable ? "TRUE" : "FALSE") << endl;
}

void CSDKDemo::OnNASStorageParam(unsigned short NASStatus, const char * pTotalSize, const char * pAvailableSize, unsigned short FullGrade, bool bFullAlarmEnable, bool bOverWriteEnable, bool bNASEnable)
{
	cout << "[OnNASStorageParam] TotalSize = "<< pTotalSize <<", AvailableSize = "<< pAvailableSize <<", bNASEnable = "<<(bNASEnable ? "TRUE" : "FALSE") <<endl;
}

void CSDKDemo::OnStorageFileNum(unsigned int FileCounts)
{
	m_FileSizeArray.clear();
	m_FileNameArray.clear();
}

void CSDKDemo::OnStorageFileInfo(unsigned int FileSizeBytes, const char * pFileName)
{	
	m_FileSizeArray.push_back(FileSizeBytes);
	m_FileNameArray.push_back(pFileName);
}

void CSDKDemo::OnStorageFileEnd()
{
	//演示下载所有媒体视频文件
	if (m_FileNameArray.size())
	{
		list <string>::iterator pos = m_FileNameArray.begin();
		while (pos != m_FileNameArray.end())
		{
			string FileName = *pos;
			m_pDriver->DownLoadMediaFile(FileName.c_str(), STREAM_IR, _HDD_MEDIA_, _VIDEO_FILE_, _AVI_SUFFIX);
			pos++;
		}
	}
}

void CSDKDemo::OnMediaFileDownLoad(_MEDIA_REC_SRC_ MediaRecType, _MEDIA_FILE_TYPE_ MediaFileType, _MEDIA_FORMAT_TYPE_ FileFormatType, _STREAM_TYPE StreamChannelType, const char * pFilePathName, unsigned int MediaLengthBytes, void * pMediaDataBuffer)
{
	//必要允许额外保存文件的二进制数据
	//二进制数据长度和缓存: MediaLengthBytes, pMediaDataBuffer	
}

