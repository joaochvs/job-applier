import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

spec = importlib.util.spec_from_file_location("job_app", Path(__file__).with_name("app.py"))
app = importlib.util.module_from_spec(spec)
spec.loader.exec_module(app)


class DailySelectionTests(unittest.TestCase):
    def test_save_answers_validates_options_saves_scope_and_queues_resume(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parent) as directory:
            runtime=Path(directory)
            bank=runtime/'answers.json'
            bank.write_text('{"profile":{},"skills":{}}',encoding='utf-8')
            fields=[{'question':'Quantos anos de PowerPoint?','type':'number'}, {'question':'Você aceita trabalhar presencialmente?','type':'choice','options':['Yes','No']}]
            app.atomic_json(runtime/'123.json',{'status':'needs_input','unknown':[f['question'] for f in fields],'fields':fields})
            row={'source_id':'123','status':'Aguardando aprovação','tipo_candidatura':'LinkedIn Simplificada','nota':'85'}
            entries=[{'question':fields[0]['question'],'answer':'2','remember':True},{'question':fields[1]['question'],'answer':'Yes','remember':True}]
            with patch.object(app,'RUNTIME',runtime),patch.object(app,'ANSWERS',bank),patch.object(app,'find_job',return_value=([],row)),patch.object(app,'BATCH_PROCESS',None),patch.object(app,'SEARCH_PROCESS',None):
                invalid=[dict(e) for e in entries];invalid[1]['answer']='Talvez'
                with self.assertRaises(ValueError): app.save_pending_answers('123',{'answers':invalid})
                self.assertNotIn('custom_answers',json.loads(bank.read_text(encoding='utf-8')))
                app.save_pending_answers('123',{'answers':entries})
                learned=json.loads(bank.read_text(encoding='utf-8'))['custom_answers']
                self.assertIsNone(learned[0]['job_id'])
                self.assertEqual(learned[1]['job_id'],'123')
                # Um valor rejeitado precisa ser corrigido, não reenviado igual.
                fields[0].update(error='Valor inválido',previous_answer='2')
                app.atomic_json(runtime/'123.json',{'status':'needs_input','unknown':[f['question'] for f in fields],'fields':fields})
                with self.assertRaisesRegex(ValueError,'já foi rejeitada'):
                    app.save_pending_answers('123',{'answers':entries})
                self.assertEqual(app.read_state(runtime/'answer-resume-queue.json',[]),['123'])
                # Outra candidatura usa o navegador: manter na fila sem iniciar nada.
                with patch.object(app,'batch_busy',return_value=True),patch.object(app,'start_batch') as start:
                    app.process_answer_queue();start.assert_not_called()
                with patch.object(app,'start_batch') as start:
                    app.process_answer_queue()
                    start.assert_called_once_with(manual=True,key='123',retry_pending=True)
                self.assertEqual(app.read_state(runtime/'answer-resume-queue.json',[]),[])
                (runtime/'123.submission.json').write_text('{}',encoding='utf-8')
                with self.assertRaises(ValueError):app.save_pending_answers('123',{'answers':entries})

    def test_retry_endpoint_does_not_start_a_new_search(self):
        handler=app.Handler.__new__(app.Handler)
        handler.path='/api/automatic/retry'
        handler.send_json=Mock()
        with patch.object(app,'read_json_body',return_value={}),patch.object(app,'start_batch') as start:
            handler.do_POST()
            start.assert_called_once_with(manual=True,retry_pending=True)

    def test_pending_card_displays_question_and_blocks_retry_after_attempt(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parent) as directory:
            runtime=Path(directory)
            (runtime/'123.json').write_text('{"status":"needs_input","unknown":["Quantos anos de Excel?"]}',encoding='utf-8')
            row={'source_id':'123','status':'Aguardando aprovação','tipo_candidatura':'LinkedIn Simplificada','nota':'85'}
            with patch.object(app,'RUNTIME',runtime):
                item=app.public_job(row)
                self.assertTrue(item['retryable'])
                self.assertEqual(item['pending_questions'],['Quantos anos de Excel?'])
                (runtime/'123.submission.json').write_text('{}',encoding='utf-8')
                self.assertFalse(app.public_job(row)['retryable'])

    def test_live_snapshot_tolerates_partial_event_and_state_writes(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parent) as directory:
            runtime=Path(directory)
            (runtime/'automatic.json').write_text('{',encoding='utf-8')
            (runtime/'events.jsonl').write_text('{"message":"Evento válido"}\n{"message":',encoding='utf-8')
            with patch.object(app,'RUNTIME',runtime),patch.object(app,'BATCH_PROCESS',None),patch.object(app,'SEARCH_PROCESS',None):
                state=app.live_snapshot()
            self.assertEqual(state['events'],[{'message':'Evento válido'}])
            self.assertFalse(state['run']['active'])

    def test_apply_uses_one_job_automatic_batch(self):
        handler=app.Handler.__new__(app.Handler)
        handler.path='/api/jobs/123/apply'
        handler.send_json=Mock()
        row={'source_id':'123','tipo_candidatura':'LinkedIn Simplificada','nota':'85','status':'Nova','url':'https://www.linkedin.com/jobs/view/123/'}
        with patch.object(app,'read_json_body',return_value={}),patch.object(app,'find_job',return_value=([],row)),patch.object(app,'batch_busy',return_value=False),patch.object(app,'start_batch') as start:
            handler.do_POST()
            start.assert_called_once_with(manual=True,key='123',retry_pending=True)

    def test_indeed_does_not_launch_linkedin_worker(self):
        handler=app.Handler.__new__(app.Handler)
        handler.path='/api/jobs/123/apply'
        handler.send_error_json=Mock()
        row={'source_id':'123','tipo_candidatura':'Indeed Fácil','nota':'85','status':'Nova'}
        with patch.object(app,'read_json_body',return_value={}),patch.object(app,'find_job',return_value=([],row)),patch.object(app,'batch_busy',return_value=False),patch.object(app,'start_batch') as start:
            handler.do_POST()
            start.assert_not_called()
            handler.send_error_json.assert_called_once()

    def test_only_confirmed_easy_jobs_with_high_score_and_no_blockers(self):
        self.assertTrue(app.eligible_quick_job({"nota": "80", "tipo_candidatura": "LinkedIn Simplificada"}))
        for row in [
            {"nota": "74", "tipo_candidatura": "Indeed Fácil"},
            {"nota": "95", "tipo_candidatura": "Externa"},
            {"nota": "95", "tipo_candidatura": "Indeed Fácil", "lacunas": "Exige senioridade acima do perfil"},
            {"nota": None}, {"nota": "inválida"},
        ]:
            with self.subTest(row=row):
                self.assertFalse(app.eligible_quick_job(row))

    def test_empty_search_import_returns_zero_without_modifying_tracker(self):
        handler = app.Handler.__new__(app.Handler)
        handler.path = "/api/search/import"
        handler.send_json = Mock()
        with tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parent) as directory:
            runtime = Path(directory)
            (runtime / "search-results.json").write_text("[]", encoding="utf-8")
            with patch.object(app, "RUNTIME", runtime), patch.object(app, "read_json_body", return_value={}), patch.object(app, "read_rows", return_value=[]), patch.object(app, "write_rows") as write:
                handler.do_POST()
                handler.send_json.assert_called_once_with({"ok": True, "added": 0, "found": 0, "eligible": 0})
                write.assert_not_called()

    def test_submission_without_active_review_is_rejected(self):
        handler = app.Handler.__new__(app.Handler)
        handler.path = "/api/jobs/123/submit"
        handler.send_error_json = Mock()
        with tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parent) as directory:
            with patch.object(app, "RUNTIME", Path(directory)), patch.object(app, "read_json_body", return_value={}), patch.object(app, "find_job", return_value=([], {"status": "Nova"})):
                handler.do_POST()
                handler.send_error_json.assert_called_once()
                self.assertFalse((Path(directory) / "123.command.json").exists())


if __name__ == "__main__":
    unittest.main()
