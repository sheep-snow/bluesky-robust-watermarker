import boto3
import json
import logging
import os
import time
from typing import Dict, Any, Optional

logger = logging.getLogger()
dynamodb = boto3.client('dynamodb')

def update_progress(task_id: str, status: str, progress: int, message: str, error: Optional[str] = None):
    """Update processing progress in DynamoDB"""
    try:
        table_name = os.environ.get('PROCESSING_PROGRESS_TABLE_NAME')
        if not table_name:
            logger.warning("PROCESSING_PROGRESS_TABLE_NAME not set")
            return
            
        item = {
            'task_id': {'S': task_id},
            'status': {'S': status},
            'progress': {'N': str(progress)},
            'message': {'S': message},
            'updated_at': {'S': str(int(time.time()))},
            'ttl': {'N': str(int(time.time()) + 86400)}  # 24 hours TTL
        }
        
        if error:
            item['error'] = {'S': error}
            
        dynamodb.put_item(TableName=table_name, Item=item)
        logger.info(f"Progress updated: {task_id} - {status} ({progress}%)")
        
    except Exception as e:
        logger.error(f"Failed to update progress: {e}")

def mark_failed(task_id: str, error_message: str, progress: int = 0):
    """Mark task as failed with error message"""
    update_progress(task_id, 'error', progress, 'Processing failed', error_message)