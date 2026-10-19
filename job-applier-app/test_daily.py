import importlib.util
from pathlib import Path
import unittest
import tempfile
import json
import sys
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("daily", Path(__file__).with_name("daily.py"))
daily = importlib.util.module_from_spec(spec)
spec.loader.exec_module(daily)

class BatchTests(unittest.TestCase):
    def setUp(self):
        self.job = dict(source_id="123", empresa="Empresa A", cargo="Analista de Dados", localizacao="São Paulo", url="https://www.linkedin.com/jobs/view/123/", tipo_candidatura="LinkedIn Simplificada", nota="85", lacunas="", status="Nova")
        self.config = {"min_score":75,"max_applications":10}

    def test_sent_job_on_another_source_is_not_repeated(self):
        old = dict(self.job, source_id="other", url="https://indeed.com/other", status="Enviada", empresa="EMPRESA A", localizacao="Sao Paulo")
        self.assertEqual(daily.select_jobs([self.job],[old],self.config),[])

    def test_limits_and_deduplicates_new_jobs(self):
        with patch.object(Path,"exists",return_value=False):
            result=daily.select_jobs([self.job,self.job,dict(self.job,source_id="456",empresa="B")],[],dict(self.config,max_applications=1))
        self.assertEqual(len(result),1)

    def test_uncertain_submission_is_never_retried(self):
        with patch.object(Path,"exists",return_value=True):
            self.assertEqual(daily.select_jobs([self.job],[],self.config),[])

    def test_retry_pending_does_not_repeat_sent_or_uncertain_jobs(self):
        pending=dict(self.job,status='Aguardando aprovação')
        with patch.object(Path,'exists',return_value=False):
            self.assertEqual(daily.select_jobs([pending],[pending],self.config),[])
            self.assertEqual(daily.select_jobs([pending],[pending],self.config,retry_pending=True),[pending])
            self.assertEqual(daily.select_jobs([pending],[dict(pending,status='Enviada')],self.config,retry_pending=True),[])
        with patch.object(Path,'exists',return_value=True):
            self.assertEqual(daily.select_jobs([pending],[pending],self.config,retry_pending=True),[])

    def test_external_and_low_score_are_excluded(self):
        self.assertFalse(daily.eligible(dict(self.job,tipo_candidatura="Externa"),75))
        self.assertFalse(daily.eligible(dict(self.job,nota="74"),75))

    def test_manual_job_uses_automatic_worker_and_records_confirmed_result(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parent) as directory:
            root=Path(directory)
            app=root/'app'
            app.mkdir()
            runtime=app/'runtime'
            runtime.mkdir()
            (app/'automation.json').write_text(json.dumps(dict(self.config,enabled=False)),encoding='utf-8')
            tracker=root/'jobs.csv'
            daily.job_tracker.save_rows(tracker,[self.job])
            def worker(command,**kwargs):
                self.assertIn('--auto-submit',command)
                self.assertEqual(command[2],'123')
                (runtime/'123.json').write_text(json.dumps({'status':'submitted'}),encoding='utf-8')
            with patch.object(daily,'APP',app),patch.object(daily,'ROOT',root),patch.object(daily,'RUNTIME',runtime),patch.object(daily,'TRACKER',tracker),patch.object(daily,'node_binary',return_value='node'),patch.object(daily.subprocess,'run',side_effect=worker) as run,patch.object(sys,'argv',['daily.py','--run','--manual','--job','123']),patch('builtins.print'):
                daily.run()
            run.assert_called_once()
            self.assertEqual(daily.job_tracker.load_rows(tracker)[0]['status'],'Enviada')
            state=json.loads((runtime/'automatic.json').read_text(encoding='utf-8'))
            self.assertEqual(state['status'],'completed')
            self.assertFalse((runtime/'automatic.lock').exists())
            self.assertEqual(len(list((root/'output'/'daily-runs').glob('*.json'))),2)

    def test_search_rejections_are_not_reported_as_zero_found(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parent) as directory:
            root=Path(directory)
            app=root/'app'
            app.mkdir()
            runtime=app/'runtime'
            runtime.mkdir()
            (app/'automation.json').write_text(json.dumps(dict(self.config,enabled=False)),encoding='utf-8')
            def search(command,**kwargs):
                self.assertTrue(command[1].endswith('scout.js'))
                (runtime/'search.json').write_text(json.dumps({'status':'completed','updatedAt':daily.datetime.now(daily.timezone.utc).isoformat(),'found':20,'evaluated':20,'eligible':0}),encoding='utf-8')
                (runtime/'search-results.json').write_text('[]',encoding='utf-8')
            with patch.object(daily,'APP',app),patch.object(daily,'ROOT',root),patch.object(daily,'RUNTIME',runtime),patch.object(daily,'TRACKER',root/'jobs.csv'),patch.object(daily,'node_binary',return_value='node'),patch.object(daily.subprocess,'run',side_effect=search) as run,patch.object(sys,'argv',['daily.py','--run','--manual']),patch('builtins.print'):
                daily.run()
            run.assert_called_once()
            state=json.loads((runtime/'automatic.json').read_text(encoding='utf-8'))
            self.assertEqual((state['found'],state['evaluated'],state['selected']),(20,20,0))
            self.assertEqual(state['applications'],[])
            self.assertIn('nenhuma candidatura foi enviada',state['message'])

if __name__ == "__main__":
    unittest.main()
